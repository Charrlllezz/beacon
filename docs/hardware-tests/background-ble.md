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

## Report back

- A notification log: sent time, received time, and the text shown.
- Anything missing, duplicated or out of order in history.
- Battery drop per phone over the run.
- Any time the connection bar showed Reconnecting/Disconnected when you opened the app.
