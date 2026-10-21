# Hardware test: per-crew keys (Model 2)

The goal is to prove on real radios what no simulator can:
- crews can't read each other;
- crews still relay for each other;
- shipped packs and QR joins land in the right crew.

Run this before the Model 2 switch defaults on (the Beyond Wonderland build).

## Setup

- **3 T-Echos** (A1, A2, B1) and **3 iPhones** on a build with Model 2 (#24–#26). Turn on **Device sheet → Per-crew keys (beta)** on every phone.
- A laptop with the flashing station (`docs/fleet-flashing.md`) and `pip install meshtastic`.
- Optional: a 4th phone with the official **Meshtastic** app.

## 1. Shipped pack: pre-keyed, no input

1. Flash A1 and A2 with `python flash_fleet.py --crew T1 --crew-name "Test crew A"`. Note the crew id it prints, for example `key 3f9c2a`.
2. On phones 1 and 2, do a fresh pairing (Device sheet → Reset RNDVU Pairing, reopen) with A1 and A2.

**Pass**
- [ ] Neither phone shows the "Your crew" step. The done screen says **In Test crew A** (or "In Crew 3f9c2a").
- [ ] The Crew tab card shows the same key id the flashing station printed, plus "from your radio".
- [ ] The Device sheet's Channel key matches it, in normal colour (no "not this crew's key").
- [ ] A text from phone 1 arrives on phone 2.

## 2. Start a crew and join by QR

1. Flash B1 without `--crew`, so it's blank. Pair phone 3 with it. It shows the crew step. Tap **Start a new crew**, name it "Test crew B".
2. On phone 3: Crew → **Invite**. On phone 2: Crew → **Join another** → scan.

**Pass**
- [ ] Phone 2 asks "Join Test crew B? You'll leave Test crew A…", and its radio restarts once.
- [ ] Phone 2 now gets phone 3's texts.
- [ ] **Undo:** phone 2 joins back to A by scanning phone 1's Invite.
- [ ] The **iPhone Camera app** pointed at an Invite QR offers "Open in RNDVU", and that leads to the same confirm.

## 3. Isolation: B can't read A

A1 and A2 in crew A, B1 in crew B, all within range.

**Pass**
- [ ] A text, rally point and SOS from phone 1 reach phone 2 and **never** show on phone 3 (chat, map, notifications).
- [ ] Phone 3's Crew tab and map don't list A1 or A2.
- [ ] The reverse holds too: phone 3's messages don't show on phones 1 and 2.

## 4. Relaying: B carries A's traffic

This is the reason every crew shares the RNDVU channel name. Put A1 and A2 **out of range of each other** and B1 between them. Separate floors, a long hallway, or tin-foil cups over A1/A2 all work. First confirm A1 and A2 can't hear each other with B1 off.

**Pass**
- [ ] With B1 off, phone 1's text doesn't reach phone 2.
- [ ] With B1 on (still in crew B), phone 1's text reaches phone 2.
- [ ] Phone 3 still shows nothing from A.

If this fails, Model 2's shared-frequency design is wrong for this firmware. Stop and file it, because it changes the design.

## 5. Meshtastic app interop (decision 6)

On phone 1: Crew → Invite → **For the Meshtastic app**. Scan it in the official Meshtastic app on phone 4, paired to a spare radio.

**Pass**
- [ ] Meshtastic shows channel "RNDVU" and the radio's region stays US.
- [ ] Phone 4 sees phone 1's plain texts. Rally, meetup and SOS show as raw `MF:…` text, which is expected.
- [ ] **Capture this:** copy the exact URL the Meshtastic app shares for its own channel (Share channel / QR) into an issue. It becomes the real-app fixture `crew.test.ts` is missing.

## 6. Leave and new key

**Pass**
- [ ] On phone 2: More → **Leave crew** gives one restart. Phone 2 stops getting crew A, and phone 1 stops getting phone 2.
- [ ] On phone 1: More → **New crew key** opens the new invite. Phone 2 rejoins by scanning it, and texts flow again.

## Record

For each check, note pass or fail, the time, and anything odd. Screenshot failures, including the Device sheet. Put the results in an issue titled "Model 2 hardware test, <date>".
