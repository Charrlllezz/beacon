# Hardware test: background connection + notifications

Goal: two locked iPhones stay on the mesh for 2+ hours, get notified, and have full history when opened. Run before Countdown NYE.

## Setup

- Two iPhones (A, B), each paired to its own provisioned T-Echo, both on a build from this branch (EAS dev or TestFlight).
- Neither phone in Low Power Mode for the main run. If there's time, repeat once with it on.
- Allow notifications when asked. For anyone who onboarded on an older build, the prompt appears the first time the app comes to the foreground.
- On B, turn on a Focus mode (e.g. Do Not Disturb) that does **not** allow RNDVU. This checks that SOS breaks through as time-sensitive.
- Plug both into Console.app if you can, filtering on `RNDVU` or `BLE`.
- **Don't swipe RNDVU away in the app switcher.** iOS treats that as "user quit" and won't relaunch the app for BLE events. That's an iOS rule we can't change (see step 7).
- Write down each phone's battery % at the start.

## Run (2h+, a message every 15 min)

Each phone stays locked except for the moment it sends. Unlock the sender, open RNDVU, send, then lock it again right away.

| Time | Sender | Send | Check on the locked phone |
| --- | --- | --- | --- |
| 0:00 | A | text "t1" | Banner titled with A's display name, body "t1" |
| 0:15 | B | text "t2" | A gets it |
| 0:30 | A | Rally Point with a note | "<A> set a rally point", body = the note |
| 0:45 | B | Set Meetup (time + place + note) | "<B> set a meetup", body "9:30 PM at …: note" |
| 1:00 | A | **Need Help (SOS)** | B lights up **despite Focus**; "SOS from <A>" |
| 1:15 | B | text "t6" | A gets it |
| 1:30 | A | text "t7" | B gets it |
| 1:45 | B | text "t8" | A gets it |
| 2:00 | A | text "t9" | B gets it |

For each row, note when the banner arrived. A delay of a few seconds is normal. If one is late by minutes or missing, write that down.

## Link loss while locked

1. Around 1:05, with A locked, take **A's T-Echo** out of range for about 10 minutes (another room or the car, or power it off).
2. Bring it back or power it on, and **keep A locked**.
3. After about 2 minutes, send a text from B. A should get the notification without anyone opening the app. That proves the background pending connect worked.
4. Repeat once by power-cycling B's T-Echo while B is locked.

## After 2h

1. Open both apps. Chat should show t1–t9, the rally, meetup and SOS in order, each once, with no duplicates.
2. Crew tab: the other person should be online, with a fresh "last heard".
3. Device sheet: Connected, Region US.
4. Note each phone's battery %.

## Release still works

1. Device sheet → **Release Device**.
2. Switch to the Meshtastic app. It should connect to the radio.
3. Switch back to RNDVU. It must **not** take the radio back. It should show Disconnected.
4. Device sheet → **Reconnect**. It connects (close the Meshtastic app first if it's still holding the radio).

## Optional: relaunch after iOS kills the app

This is hard to force. Leave B locked overnight, or open several heavy apps (camera, games) on B to apply memory pressure. Then send from A. If B notifies, iOS relaunched RNDVU in the background through BLE state restoration. Console shows `BLE state restored with 1 connected peripheral(s)`.

## With one phone: the laptop stands in for B

When only one person is around, the second T-Echo plugged into the laptop can play phone B.

1. Pair the phone with one T-Echo as usual. Plug the other T-Echo (same crew) into the laptop by USB.
2. Stop the laptop sleeping while it's plugged in: `powercfg /change standby-timeout-ac 0` (set it back with `30` afterwards).
3. Run `python scripts/stand_in_crew.py` (add `--port COM5` if it can't find the radio). It checks the radio is on the RNDVU channel.
4. Send t1 from the phone, then lock it. The script sends B's rows on the schedule above (t2, the meetup, the SOS, t6, t8). After two hours it sends a numbered text (`n1 14:05`, `n2 14:20` …) every 15 minutes for 48 hours.
5. Put the phone in a Focus mode that doesn't allow RNDVU, so the SOS at 1:00 checks breaking through. If you'd rather not have it go off overnight, start the script with `--no-sos`.
6. Do the link-loss steps on the phone's T-Echo (out of range or power it off, bring it back, keep the phone locked) and check the next numbered text still notifies.

**Next morning**, compare the phone with the CSV the script wrote (`stand-in-<date>.csv`):
- Every `n` text the script sent appears in chat once, in order, with no gaps.
- The phone's notification history has a banner for each one. Note any that are missing or minutes late.
- Every text sent from the phone shows in the CSV as `in`.

One phone covers everything above except two phones locked at the same time and a second iPhone model or iOS version.

## Report back

- A notification log: sent time, received time, and the text shown.
- Anything missing, duplicated or out of order in history.
- Battery drop per phone over the run.
- Any time the connection bar showed Reconnecting/Disconnected when you opened the app.
