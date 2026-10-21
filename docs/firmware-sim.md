# Firmware sim tests

`npm run test:sim` runs the app's real connection, pairing and message code
(`RealBleManager`, `MeshtasticCodec`, `PacketRouter`) against **real Meshtastic
firmware**: three `meshtasticd` nodes at the pinned fleet version
(`FLEET_FIRMWARE`, now 2.7.26), in Docker.

MockFirmware (`npm test`) only knows what we taught it. This suite catches the
firmware changing under us. The 2.7.24 position-precision change and the
2.7.13 telemetry gate were that kind of change.

## How it works

It uses the same model as [Meshtasticator](https://github.com/meshtastic/Meshtasticator)'s
interactive simulator:

- `meshtasticd --sim` replaces the LoRa chip. Instead of transmitting, a node
  hands each radio packet to its TCP API client as a `SIMULATOR_APP` packet.
- `SimMesh` (`src/services/ble/sim/`) owns every node's TCP connection and
  carries those packets to the nodes in range. The tests use a chain,
  a ↔ b ↔ c, so c only hears a through b's rebroadcast.
- `TcpBlePlx` stands in for `react-native-ble-plx`. `RealBleManager` thinks it is
  talking to a radio over Bluetooth, but it is talking to node a over TCP.

## What it checks

| Test | What it proves on real firmware |
| --- | --- |
| Config drain | The codec decodes the firmware's startup dump: version, node number, config-complete |
| Pairing | One transaction sets region US, the RNDVU channel with position precision 32, battery broadcasts on, the name, and channels 1–7 off. One reboot, then the app reconnects |
| Rename | A later rename (a lone `setOwner`) reboots the radio once, and the app reconnects |
| Battery | Pairing turns battery broadcasts on, and c's battery reaches the app on a over two hops |
| Text a → c | A message from the app reaches b directly and c over two hops |
| Text c → app | A crew message lands in the app's message store |
| Position | A phone-shared position reaches the crew without losing precision |
| Position request | The radio answers with its exact position (fails if the channel has no precision set) |

## What it does not check

Test these on hardware:

- **Encryption on the air.** The sim hands decoded packets across, so two crews
  with different keys would still hear each other here. Model 2 key isolation
  needs radios.
- **Bluetooth.** Pacing, iOS background behaviour and reconnecting after a
  walk out of range (`docs/hardware-tests/background-ble.md`).
- **RF.** Range, collisions and airtime. For Coachella-scale capacity, use
  Meshtasticator's discrete-event simulator (a separate study).
- **nRF52-only behaviour.** meshtasticd is the Linux build of the same firmware.
  Mesh and API logic are shared, but power and GPS handling differ from the
  T-Echo.

## Running it

CI (`.github/workflows/ci.yml`) runs it on every pull request, on GitHub's
Linux runners. Nothing needs installing.

To run it locally, you need Docker. On Windows that means Docker Desktop, which
needs WSL 2.

```sh
docker compose -f docker-compose.sim.yml up -d
npm run test:sim
docker compose -f docker-compose.sim.yml down -v   # -v wipes the nodes' saved config
```

## Changing the firmware version

1. Change the image tag in `docker-compose.sim.yml`.
2. Change `FLEET_FIRMWARE`.
3. Run the suite.

A failure tells you what to read in the firmware changelog before you re-flash
the fleet (see `docs/fleet-firmware.md`).
