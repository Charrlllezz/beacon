# The app at the festival

Status: **draft for discussion**. Oct 20, 2026.

The aim is to plan the in-festival experience around what a crew is trying to
do, check it against what the app does today, and choose what to build for each
festival.

## What the crew is trying to do

When cell service dies, a crew wants to:

1. **Stay findable.** "Where is everyone?"
2. **Coordinate.** "I'm going to X. Meet at Y at 11."
3. **Regroup.** "I'm lost. Get me to you."
4. **Get help.** "Something is wrong. Come now."

All four have to work with:
- the phone locked in a pocket;
- no cell service at all;
- one hand;
- bright sun or the dark;
- a few seconds of attention.

## Rules every feature has to follow

- **Glanceable.** The answer is on screen within 3 seconds of unlocking. Typing
  is the fallback, not the main path.
- **Locked-phone first.** Anything that matters reaches the lock screen
  (PR #4). Everything else can wait until the app is opened.
- **Honest about age.** Every location and status shows how old it is. A
  confident-looking stale pin is worse than none.
- **Honest about delivery.** "Sent" has to mean something specific, and the
  crew should see when a message is known to have reached the mesh.
- **Airtime is a shared budget.** Every broadcast uses the frequency that all
  RNDVU crews share (see the Model 2 doc). Features ask for fresh data when
  someone needs it, rather than spending airtime all the time.
- **Battery is a feature.** The phone dies before the radio does. Nothing in the
  app should drain the phone in the background.

## A day at the festival, moment by moment

### 1. Arrival: "Is this working?"
- **Today:**
  - The ConnectionBar shows radio status.
  - The Chat tab opens first.
  - The Crew tab lists members with battery and last heard.
- **Gaps:**
  - There's no single "you're good" signal at the gate.
  - The pre-festival ready-check would catch problems at home: radio charged,
    map downloaded, crew joined, notifications on.
- **Proposal:**
  - A **crew status strip** at the top of every tab: "4 of 6 in range, last
    heard 2 min ago".
  - The **ready-check** screen before the festival. The Beyond Wonderland
    no-call test depends on it.

### 2. Splitting up: "Where's everyone going?"
- **Today:**
  - The "Heading to [stage]" quick action.
  - "Going" picks on the Lineup tab.
  - Countdown and Beyond Wonderland have no stage data yet, so the heading row
    is hidden there.
- **Gaps:**
  - Status is something you send once, and it goes stale.
  - The crew can't see at a glance who is where.
- **Proposal:**
  - On the Crew tab, show each person's **latest status with its age**
    ("Heading to Sahara, 12 min").
  - Stage data for the NOS venue (queue item 7).

### 3. Finding each other: "Where are you right now?"
- **Today:**
  - Crew pins on the offline map. Positions come from each radio's GPS, which
    by default sends only after moving about 100 m, or every 15+ minutes.
  - Pins carry **no age**, so a 40-minute-old pin looks live.
- **Gaps:** age, freshness, and pointing someone in a direction.
- **Proposal:**
  - **Before Countdown (small):** show age under each pin ("3m", "40m") and
    fade pins older than about 15 minutes.
  - **Coachella:**
    - The **arrow finder**: heading and distance to one person, from phone GPS
      and the compass.
    - **"Find me"**: one person's radio sends its position every 20 s for
      5 minutes, so the arrow stays live only while it's needed.

### 4. Meeting up: "Meet at the ferris wheel at 11"
- **Today:** rally point and meetup cards in chat, with notifications.
- **Gaps:**
  - Nobody knows who has seen the meetup, or who is on the way.
  - A meetup time passes with no reminder.
- **Proposal:**
  - A one-tap **"On my way" / "Can't make it"** reply on rally and meetup
    cards: a small structured message.
  - A **local reminder** 10 minutes before a meetup time. It's set on each
    phone and uses no airtime.
  - The rally point pinned at the top of the map until it expires.

### 5. Something's wrong: "SOS"
- **Today:**
  - The SOS quick action sends the location.
  - It's a time-sensitive notification that breaks through Focus.
  - It shows as a card in chat.
- **Gaps:**
  - It's one message. If it's missed, it's gone.
  - There's no "I'm coming" reply.
  - There are no medical or info points on the map.
  - The app doesn't say that RNDVU is not 911.
- **Proposal:**
  - **SOS stays active** until the sender cancels it:
    - it re-sends every few minutes with a fresh location (bounded, so it
      doesn't flood the airtime);
    - it shows as a banner on every tab;
    - other phones send **"I'm coming"**, and the sender sees who is coming.
  - **Medical and info tents** in the venue config, next to stage markers, so
    the SOS banner can say "nearest medical: 250 m".
  - A clear line on the card and in the app: **for real emergencies, find staff
    or medical. RNDVU reaches your crew, not emergency services.**

### 6. Did they get it? (every message)
- **Today:** "sent" only means the phone reached the radio.
- **Proposal:** a **"reached the crew" tick**. When another radio relays a
  broadcast, the sending radio hears the relay and reports it to the phone as
  an implicit ack. That proves the message is out on the mesh, at no airtime
  cost. Per-person read receipts would cost airtime for every message: skip
  them.
  - *Check how the app receives the implicit ack before promising this. Use
    the sim.*

### 7. Phone dying, or phone dead
- **Today:** nothing specific. The radio keeps sending its GPS position even if
  the phone is dead, so the crew still sees the pin as long as the radio is on.
- **Proposal:**
  - **Battery coaching**: "Phone at 15%. RNDVU keeps working while locked.
    Turn on Low Power Mode." The radio's battery shows in the status strip.
  - On the card: **"If your phone dies, keep the radio on. Your crew can still
    see where you are."**
  - Later: T-Echo button presets (Meshtastic's canned messages, such as "I'm
    OK" or "Come find me") so someone can reply with no phone at all. That's a
    radio-config change, so it's a decision.

### 8. End of the night: "Heading out"
- **Today:** the meetup flow.
- **Proposal:** nothing new. Meetup plus reminder plus "On my way" covers it.

### 9. After the festival
- **Proposal:** an **"End trip"** flow:
  - release the radio;
  - remind people how to return it (for rentals);
  - ask the debrief questions (were messages delivered, battery at the end,
    what was confusing, would they pay);
  - save the answers so you can collect them at the debrief.

  This doubles as Beyond Wonderland's measurement tool.

## When to build what

**Countdown build (frozen Dec 7–13): small and safe only.** Everything else
goes into the next build.
- Age labels and fading on crew pins.
- The "RNDVU is not 911" line, plus the phone-dead tip on the card.
- The one-off Countdown channel key (Model 2 doc, decision 5).

**Beyond Wonderland (shipped, nobody to call):**
- Crew status strip.
- Ready-check screen.
- "Reached the crew" tick.
- SOS that stays active, with "I'm coming".
- "On my way" replies and meetup reminders.
- End-trip debrief.
- Model 2 (separate doc).

**Coachella (the moment creators will film):**
- Arrow finder plus "Find me".
- Stage, medical and info markers.
- Battery coaching.
- Status-with-age on the Crew tab.

**Later:**
- Radio button presets for a dead phone.
- Community tags.
- Waypoint packets so official-app users see rally points.

## Airtime budget at Coachella (to check in the capacity study)

| Traffic | Today | With this plan |
| --- | --- | --- |
| Positions | Radio GPS when moved ~100 m, or every 15+ min | Same, plus "find me" bursts (20 s for 5 min, on demand) |
| Battery | 30 min (#14) | Same |
| Names (NodeInfo) | Firmware default | Same |
| Chat, status, rally | As used | Plus small replies ("On my way", "I'm coming") |
| SOS | One message | Repeats every 2 min while active, no cap (sender cancels) |

At 240 radios on one frequency, the capacity study should confirm this fits, or
set the intervals to use.

## Decisions (Oct 20, 2026)

1. **Crew glance: both.** The status strip goes on every tab, and Crew becomes
   the first tab.
2. **SOS repeats every 2 minutes and never stops on its own.** Only the sender
   cancels it.
   - This is the heaviest airtime item, so the capacity study must check it.
   - The banner should make cancelling obvious, so a forgotten SOS doesn't run
     all night.
3. **"On my way" / "Can't make it" replies: yes.**
4. **Pin-age labels go into the Countdown build**, before the freeze.
5. **The end-trip debrief lives in the app.**
