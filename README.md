# RNDVU

Festival crew app for when there is no cell service. Everyone in the crew carries a cheap [Meshtastic](https://meshtastic.org) LoRa radio (a LilyGO T-Echo) paired to their phone over Bluetooth; the radios form a mesh with no towers and no Wi-Fi. RNDVU sits on top of that mesh and answers the questions crews actually have once they get separated: where is everyone, where and when are we meeting, who needs help, and who's going to which set. Started as "Beacon" (hence the repo name); rebranded RNDVU in April 2026.

**Status: working prototype, built for Coachella 2026 Weekend 2.** Real Bluetooth against real radios, a TestFlight build, and 63 passing tests. The git history records a TestFlight build and hardware debugging with testers; it does not record festival-day use, so this README doesn't claim it. See [Status](#status).

```bash
npm install                # lockfile + .npmrc (legacy-peer-deps)
npm test                   # vitest: codec, mock firmware, message protocol
npx expo run:ios           # native build; BLE and maps rule out Expo Go
```

With a Meshtastic radio nearby, onboarding scans, pairs, and **reconfigures the radio**: it writes the RNDVU channel + key, sets the LoRa region to US, and reboots it. Without hardware, flip `USE_MOCK = true` in `src/services/ble/BleManager.ts` and the app runs in the simulator against an in-process virtual radio (below).

## What it does

| Tab | Screen | What's there |
| --- | --- | --- |
| — | `OnboardingScreen` | Name yourself, scan, pick a radio, connect. BLE failures are classified into plain-English causes (usually "the Meshtastic app still has the radio"). |
| Chat | `ChatScreen` | Group chat on the crew channel. `+` opens `QuickActions`: *Heading to* a stage, *Rally Point* (your GPS or a dropped pin, with a note), *Set Meetup* (time wheel, stage / custom / pin, note, live countdown), *Need Help* (SOS with a confirm dialog). Own messages show `○ ✓ !` send status. |
| Map | `MapScreen` | Native map with offline satellite tiles, crew pins in their chosen colour, your blue dot. Long-press to tag a spot (water, food, restroom, camp…) and broadcast it; search and filter tags. |
| Lineup | `ScheduleScreen` | Coachella W2 2026: 189 sets across 9 stages, three day tabs, artist search, stage chips, "My Sets". *I'm Going* broadcasts your pick, un-picking broadcasts that too; overlapping picks get a Keep Both / Replace dialog. Times render in the festival's timezone, not the phone's. |
| Crew | `CrewScreen` | Everyone on the channel: online/last heard, radio battery, signal bars from SNR, distance from you, "Near Sahara", "Watching X · Stage" from their picks. Tap to jump to them on the map. |
| ⚙ | `DeviceScreen` | Sheet reachable from the gear and the connection bar: Reconnect, Re-provision, Release Device (hand the radio to the Meshtastic app), Reset Pairing, Factory Reset, plus diagnostics — LoRa region (flagged red when UNSET, which means "receives but never transmits"), channel-key fingerprint, node id, firmware, hardware model. |

## Architecture

```
RealBleManager ──► MeshtasticCodec ──► PacketRouter ──► MessageService ──► zustand stores ──► screens
(react-native-    protobuf wire      dedup, route by    parse MF:* text    device, crew,
 ble-plx)         format, hand-      portnum, gate      into typed         messages, schedule,
   ▲              written            crew membership    messages           tags, mapCalibration
MockBleManager ──► MockFirmware (virtual radio; emits real protobuf bytes, decoded by the same codec)
```

- **`src/services/ble/`** — `RealBleManager` (549 lines) owns the GATT session; `MeshtasticCodec` (768) encodes and decodes; `PacketRouter` fans each `FromRadio` into the stores. `MockFirmware` + `MockPeers` + `MockScenarios` are the simulator.
- **`src/services/mesh/MessageService.ts`** — the `MF:` protocol (below). **`src/services/map/TilePrefetch.ts`** — offline tiles. **`src/services/festival/FestivalConfig.ts`** — reads `src/config/festivals/coachella-w2-2026.json`.
- **`src/store/`** — six zustand stores; everything that matters persists to AsyncStorage (messages capped at 500, debounced, flushed on background; crew aged out after 7 days; picks, tags, colour, display name, last radio).
- **`App.tsx`** — wires BLE listeners once at the root, runs phone GPS, auto-reconnects on launch and foreground, and releases the radio on background because a T-Echo accepts one BLE central at a time.

## The interesting parts

**The app provisions the radio.** Nobody in the crew should have to open the Meshtastic app or scan a QR code. On first connect RNDVU drains the radio's config, waits for its node number, then writes admin messages: LoRa region in its own committed transaction *first* (an interrupted provision once left region UNSET, which is a radio that silently never transmits), then channel 0 = `RNDVU` with a 32-byte PSK, disables channels 1–7, commits, reboots. Factory reset sets a flag so the next reconnect re-runs the whole sequence. Every config write sends the *complete* message because proto3 defaults clobber unset fields; a partial `LoRaConfig` write once turned `tx_enabled` off.

**Structured messages ride on plain text.** Every type in the table goes out on Meshtastic's `TEXT_MESSAGE_APP` port as a short `MF:`-prefixed string, so stock firmware forwards it and a crew member on the official app just sees terse text. Malformed input falls back to a text bubble; 25 round-trip and malformed-input tests cover it.

| Code | Type | Payload |
| --- | --- | --- |
| `H` | heading | `stageId` |
| `R` | rally | `lat,lng[:note]` |
| `!` | SOS | `lat,lng` |
| `G` / `U` | going / un-going | `stageId:artistId` |
| `M` | meetup | `HH:MM\|location\|note\|lat,lng` (pipes stripped from free text) |
| `T` | tag | `lat,lng:category:name` (old two-field form still parses) |
| `K` | colour | hex |

**A hand-written protobuf codec, and a virtual radio to test it.** No generated code: `MeshtasticCodec.ts` reads varint / length-delimited / fixed32 / float fields straight off the wire and encodes `ToRadio`, `AdminMessage`, and every `FromRadio` variant the app cares about. It also has *encoders* for the radio's side, and that is what `MockFirmware` uses: a 381-line in-process Meshtastic that consumes the app's real `ToRadio` bytes, dispatches admin messages, keeps a node DB, reboots on command, and emits real `FromRadio` bytes that the app decodes through the same path as hardware. Seven scenarios (normal, solo, flaky BLE, 25-peer crew, late joiner, stale peer, wrong channel) and the Debug screen drive it. The bugs this caught are in the tests: `latitude_i` is `sfixed32`, not varint, so western-hemisphere positions decoded as garbage; `want_ack` on a broadcast triggers Meshtastic's reliable-broadcast flood and stalls a busy channel for minutes.

**BLE against real iPhones.** The comments in `RealBleManager` read like a field log: no MTU negotiation because it caused 1-second connect failures on an iPhone 13; reads paced at 200 ms because older BLE stacks tear the GATT session down under load; a single-flight guard because the notify, the 5 s backup poll and the config drain all pop the same FIFO; a 60 s heartbeat so firmware doesn't drop an idle phone; exponential backoff from 500 ms to 15 s over ten attempts.

**Offline satellite maps.** `TilePrefetch` downloads ESRI World Imagery for a 5.6 km box around the venue at zoom 14–18 (2,746 tiles) into the app's documents directory and hands the path to `react-native-maps`' `UrlTile` with `offlineMode` on when you're near the venue. Tiles are written with no extension because the native cache reads `{z}/{x}/{y}` verbatim; with `.jpg` every tile was invisible and the map silently fell back to the network.

**Crew is not the node DB.** A Meshtastic radio streams every node it has ever heard on connect. The first version made all of them crew ("the 35+ random nodes"). Now `upsertMember` only creates a member for a node heard within the online window; packets from unknown nodes update nothing until a fresh `NodeInfo` arrives.

**Position comes from the phone; presence comes from the radio.** Phone GPS is the authoritative `myLocation` and the radio's coarser self-fix can't overwrite it, while peers still see you via the radio's own position broadcasts. "Online" means heard within an hour (about four missed 15-minute broadcasts) and any packet at all, including flood duplicates, refreshes it.

## Status

Verified in this tree: `tsc` clean, `vitest` 63/63. `USE_MOCK = false`, so the checked-in build talks to hardware.

Known gaps, all noted in the code:

- **One shared channel key, compiled in.** `RNDVU_CHANNEL_PSK` is a constant, so every install is one crew. Per-crew keys via invite link ("Model 2") is designed but not built; the tag "community" scope is hard-wired to crew for the same reason.
- `setLocationSharing` (privacy toggle) is written but marked untested on hardware and not wired to UI.
- Stage markers on the map are disabled: stage coordinates in the config aren't accurate enough.
- Temporary `[RNDVU-DIAG]` logging in `PacketRouter` and `MessageItem` is still in, pending confirmation of a fix on device.
- Leftovers from the Beacon era: `MF:C` map-calibration messages and `useMapCalibrationStore` are parsed and stored but nothing reads them; `lib-2026.json` and the 2.2 MB `lib-2026-map.png` are unreferenced; `date-fns`, `react-native-reanimated`, `expo-secure-store`, `expo-linking`, `expo-font` are installed but unused.
- The festival is a build-time import. `FestivalConfig.loadConfig` exists for switching at runtime; nothing calls it.
