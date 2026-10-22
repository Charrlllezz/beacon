# Reflashing and resetting the T-Echos

Do this to put every radio on the fleet firmware (`FLEET_FIRMWARE`, now 2.7.26)
and wipe it clean before setup. `tools/flash-fleet/flash_fleet.py` does the
flashing and keeps the inventory. You plug the radios in and press the reset
button.

Each radio comes out **blank**: no region, no channel, no name, unless you key
it for a shipped pack with `--crew` (below). Blank is intended. Pairing in the RNDVU app sets region US, the RNDVU channel, location
sharing, battery reports and the user's name in one step, with one reboot. Names
stay on the phone; the flashing station never sets them.

## One-time setup (Windows tower or laptop)

1. Install Python 3.10 or newer from python.org, and tick "Add to PATH".
2. In a terminal, run `pip install meshtastic`. The script uses it to read each
   radio back after flashing.
3. Get the repo, then `cd tools/flash-fleet`.
4. The first run downloads the official 2.7.26 firmware bundle (46 MB) from
   GitHub and checks its SHA-256. It refuses to flash if the checksum doesn't
   match.

## Per radio (about 2 minutes)

Run `python flash_fleet.py`. It loops, one radio at a time.

1. **Charge first.** Flashing a radio with a nearly flat battery can fail
   partway.
2. Plug the T-Echo into the computer with a **data** USB-C cable. Some cables
   only charge.
3. **Double-tap the reset button.** The radio shows up as a USB drive. The
   script spots it and prints the bootloader and SoftDevice versions.
4. The script copies the **factory-erase** file that matches the radio. It wipes
   the radio's settings, keys, names and the list of radios it has heard. The
   script connects to the erase program, which is what starts it, and prints
   its messages. **Don't touch the radio**; it comes back as the drive by itself.
   Double-tap only if the script asks.
5. The script copies the **firmware**. The drive disappears while the radio
   reboots into Meshtastic.
6. The script reads the radio back over USB: firmware version and node id. It
   then appends a row to `inventory.csv` and prints a label (`R01`, `R02`, and
   so on). A radio that was flashed before keeps its old label.
7. **Write the label on the case**, photograph the radio, and unplug it.

Windows may offer to "scan and fix" the drive. Ignore that. Plug in only one
radio at a time, because the script stops if it sees two.

**Flags**
- `--skip-verify` runs without the Meshtastic package. You lose the node id and
  version check.
- `--firmware-only` updates firmware without wiping, which is for radios you
  want to keep paired.
- `--once` does a single radio.
- `--crew ORDER [--crew-name "Ash's crew"]` pre-keys a shipped pack (Model 2;
  see below).

## Shipped packs: pre-keying an order (Model 2)

`python flash_fleet.py --crew 1001 --crew-name "Ash's crew"`

- **The first run for an order** generates its crew key (32 random bytes from
  the OS) and saves it in `orders/1001.json`. That file also holds the crew id
  and an `invite_url` for the printed card's backup QR.
- **Every radio flashed in that run** then gets the RNDVU channel with that
  key over USB (`meshtastic --seturl`). The script reads it back to check, and
  the inventory's `crew` column records `1001:<crew id>`.
- **Re-running with the same order reuses its key.** A pack done over two
  sessions, or a replacement radio, lands in the same crew.
- **The crew needs no invite.** They pair in RNDVU and the app adopts the
  radio's key. The done screen and the Crew tab show the crew; check the id
  matches what the script printed.

**`orders/` is secret.** It's git-ignored. Anyone with the file can read that
crew's messages. Back it up somewhere private, and delete an order's file once
its radios come back and are wiped.

If the script prints `CREW KEY FAILED`, flash that radio again with the same
`--crew`.

## Check each radio (the week-1 health check)

Flashing proves the chip works. These checks prove the radio does. Pair each one
in the RNDVU app, on a TestFlight build with #13 and #14.

| Check | How | Pass |
| --- | --- | --- |
| Bluetooth | Pair in the app | It connects. One reconnect after setup, and no "Setup didn't finish" |
| Firmware | Device sheet | Firmware shows 2.7.26 in the normal colour |
| Config | Device sheet | Region US, channel RNDVU, Location sharing on |
| LoRa | Two paired radios, send a message | It arrives on the other phone |
| GPS | Outside, 5 min, then the map | The radio's pin appears |
| Display | Look at it | The e-paper screen updates |
| Battery | The other phone's Crew tab | The battery shows within a few minutes |

Record failures in the `notes` column of `inventory.csv`. Dead BME280 or IMU
sensors don't matter, because RNDVU doesn't use them.

When the check is done, **wipe the radio again** (`python flash_fleet.py`, the
same steps) so it goes out blank to the crew. Crew members pair their own radio
with their own name.

## If something goes wrong

- **No drive after a double-tap.** Try another cable and another USB port. Tap
  faster.
- **"Unknown SoftDevice".** The radio's bootloader is unusual. Don't force it.
  Note the label and check the Meshtastic nRF52 bootloader docs.
- **"NOT ERASED (old settings still on it)".** The erase file was copied but the
  radio kept its old name, region and channel. This happened on the very first
  real run, twice in a row. Wipe it over USB instead:
  `python -m meshtastic --port COMx --factory-reset-device`, then **restart the
  radio** (hold power, or tap reset once). The reset only applies on restart,
  and until then the radio can stop answering on USB. It's blank when the screen
  says "Welcome to Meshtastic". Then run the script again with
  `--firmware-only`, or key it as below.
- **Why erases failed at first.** The erase program waits until something opens
  its USB serial port, and only then formats. The script now opens it and shows
  the erase program's own messages (`| Formating ...`), so **don't double-tap
  during the erase**. The radio goes back to the bootloader drive by itself.
- **"VERIFY FAILED".** The radio flashed but didn't report 2.7.26. Flash it
  again. If it fails twice, set it aside.
- **The bootloader is older than 0.6.** It works, but Meshtastic recommends
  updating old bootloaders. The inventory lists each radio's version, so they're
  easy to find later.

## Files

- `tools/flash-fleet/flash_fleet.py`: the script. The firmware pin sits at the
  top, and a test keeps it in step with the app's `FLEET_FIRMWARE`.
- `tools/flash-fleet/inventory.csv`: one row per flash. It's git-ignored
  because the repo is public; back it up somewhere private.
- `tools/flash-fleet/.cache/`: the downloaded firmware. Also git-ignored.

Changing the fleet firmware means updating the pins together: this script, `FLEET_FIRMWARE`,
and `docker-compose.sim.yml`. CI then runs the sim suite against the new version
(see `docs/fleet-firmware.md`).
