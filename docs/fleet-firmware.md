# Fleet firmware

**Every radio runs the same version: `2.7.26` (`FLEET_FIRMWARE` in `src/utils/firmware.ts`).** Flash all of them to it, test against it, and only move the whole fleet to a new version on purpose. The Device sheet marks a radio amber when it's on a different version, and red on 2.8 (still alpha).

## Firmware changes that affect RNDVU

All checked in the firmware source at each release tag.

| Since | Change | RNDVU impact |
| --- | --- | --- |
| 2.7.13 (introduced between 2.7.9 and 2.7.13) | Device telemetry (battery) only goes out over the mesh if `telemetry.device_telemetry_enabled` is set. It defaults to off. | Crew battery levels don't reach other phones. **Not set by RNDVU provisioning yet: open decision.** |
| 2.7.24 | A channel without `module_settings` uses position precision 0, so the radio broadcasts **no position**. | Fixed in provisioning (#7). Radios provisioned by older builds show "Location sharing: off" until you tap Re-provision. |
| 2.8.x (alpha) | Upgrade migration switches position sharing and telemetry to opt-in on public channels, and turns telemetry broadcasts off. | Not supported; don't flash it. |

## Before an event
1. Flash the radio to `2.7.26`. The T-Echo is nRF52, so use the UF2 drag-and-drop file from the web flasher.
2. Pair it with RNDVU (onboarding provisions the radio).
3. In the Device sheet check: Firmware `2.7.26` with no colour, Region `US`, Location sharing `on`, and Offline map `ready ✓`.
