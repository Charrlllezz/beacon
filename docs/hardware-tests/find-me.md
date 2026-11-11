# Hardware test: Find me, Ultra Wideband and the lock-screen activity

This checks on real phones what no simulator can: the request reaches a
locked phone, the friend's radio answers by itself, UWB measures through a
crowd, and the Live Activity keeps measuring with the phone in a pocket. It
also measures the battery cost.

## Setup

- 2 T-Echos in the same crew and 2 iPhones with UWB (iPhone 11 or later, not
  SE) on a build with #38–#40. For the locked-phone checks, both on
  **iOS 18.4 or later**.
- Note each phone's model and iOS version, and charge both to 100%.

## 1. The request (phone B locked in a pocket)

1. Phone A: Crew → B → **Ask B to help**.

**Pass**
- [ ] B buzzes within ~30 s: "A is looking for you", even with a Focus mode on.
- [ ] A shows "Asked B…", and B's pin updates within a minute without B
  touching anything. That's B's radio answering.
- [ ] With no tap from B, one reminder buzz about 2 minutes later.
- [ ] **B's phone switched off:** A still gets B's position from the radio.
- [ ] **B's radio with no GPS fix** (indoors, B's phone off since the radio
  booted): A gets no position, only the alert on B's phone. That's expected:
  a radio that doesn't know where it is declines to answer.

## 2. One tap

1. B taps **Help them find me** on the notification.

**Pass**
- [ ] B's phone opens "A is finding you", and A shows "B is helping".
- [ ] B's pin moves every ~15 s while B's screen is on.
- [ ] Within ~10 m in the open: A's arrow says **Precise · Ultra Wideband**
  with a decimal distance, and follows B as A turns.
- [ ] B: **Light up my screen** flashes, and is easy to spot from 20 m in the dark.

## 3. Locked phone (iOS 18.4+)

1. With precise working, B locks the phone and puts it in a pocket.

**Pass**
- [ ] B's lock screen shows "A is finding you · 6.2 m", updating.
- [ ] A's distance keeps updating. Direction may drop out; "getting closer /
  further" should still work.
- [ ] **Stop** on B's lock screen ends it on both phones.
- [ ] On iOS 17 or 18.0–18.3: locking B says "Open RNDVU to keep measuring",
  and A falls back to GPS. That's expected.

## 4. Crowd

Have 5–10 people stand between A and B at 5–10 m.

**Pass**
- [ ] Distance keeps updating. Note how often direction drops out.

## 5. Battery

1. Note both phones' battery %.
2. Run three 10-minute searches (steps 1–3), B locked for most of each.
3. Note battery % again, and compare with 30 minutes of both phones idle with
   RNDVU open.

**Budget:** under 3% per search on each phone. Over that, the locked-phone
version doesn't ship for Countdown.

## 6. Low battery

- [ ] With B in Low Power Mode, steps 1–2 still work on GPS, with no UWB and no
  lock-screen activity on B.

## Record

For each check note pass or fail, phone models, iOS versions, distances and
anything odd. Put the results in an issue titled "Find me hardware test, <date>".
