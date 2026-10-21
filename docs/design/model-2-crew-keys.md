# Model 2: per-crew keys

Status: **draft for decisions**. Oct 20, 2026. Plan work-queue item 4: design in
week 5, finished by week 13, never cut.

## Why

Today every RNDVU install uses one channel key that is compiled into the app
(`RNDVU_CHANNEL_PSK` in `MeshtasticCodec.ts`). That causes three problems:

1. **Every RNDVU radio is in one crew.** Two paying crews at the same festival
   would see each other's messages, pins, rally points and SOS. Beyond
   Wonderland can still run with one crew. Coachella, with 40–80 crews a
   weekend, can't.
2. **The key isn't secret.** The repo is public, so anyone can read the key and
   decrypt RNDVU traffic with the official Meshtastic app.
3. **Shipped packs can't be set up in advance.** A crew can't get radios that
   are already "theirs" out of the box.

## Goal

A crew is a group of radios and phones that share one random 256-bit key. Only
that crew can read its messages. **Every RNDVU radio still relays every other
crew's packets**, so the mesh is as big as the festival's RNDVU fleet.

A shipped crew pairs and is in its crew with nothing to type or scan. A crew
that forms at the festival joins by scanning a QR.

## How Meshtastic makes this work

Checked in the firmware source at the fleet version (2.7.26) unless marked
otherwise.

- **Encryption is per channel.** Each channel has a name and a PSK: 32 bytes
  means AES-256. A radio can only read packets on a channel whose key it holds.
- **Radios relay what they can't read.** The default rebroadcast mode is `ALL`,
  which means any packet on the same frequency and LoRa settings is relayed
  even if it can't be decrypted (`FloodingRouter`, `Config.RebroadcastMode`).
  So crews with different keys still extend each other's range.
- **The frequency comes from the primary channel's *name*.** The slot is
  `hash(primary channel name) % number of slots`, unless `lora.channel_num` is
  set (`RadioInterface.cpp`).
  - **Consequence:** if every crew keeps the channel name `RNDVU` and only the
    key differs, every crew is on the same frequency and relays for the others.
  - A per-crew channel name would scatter crews across frequencies, into
    meshes of 3–6 radios that can't help each other. **Don't do that.**
- **Packets carry a 1-byte channel hash**, computed as `xor(name) ^ xor(psk)`,
  so a radio knows which key to try. With many crews, two will sometimes share
  a hash byte. The radio then tries the wrong key, fails to decode the packet,
  treats it as not for this crew, and still relays it. Harmless.
- **Invite format.** Meshtastic shares channels as `ChannelSet { repeated
  ChannelSettings settings = 1; LoRaConfig lora_config = 2; }`, encoded as
  URL-safe base64 in a link (`https://meshtastic.org/e/#...`). Using the same
  payload means an official-app user can join an RNDVU crew. *The URL shape
  comes from Meshtastic's docs and apps, not the firmware source. Check it
  before building.*

## Design

### What a crew is (on the phone)

```ts
interface Crew {
  id: string;          // short hash of the key, e.g. "c7f2a1" (also the fingerprint)
  psk: Uint8Array;     // 32 random bytes
  displayName: string; // "Ash's crew"; phone-side only, never on the radio
  createdAt: number;
  source: 'created' | 'invite' | 'radio';
}
```

- The crew lives in AsyncStorage (`rndvu_crew`). One crew per phone at a time.
- The radio's channel 0 is always **named `RNDVU`** and holds the crew's key.
  The name is what keeps every crew on one frequency.

### Three ways into a crew

**1. Shipped pack (Beyond Wonderland, Coachella): no input.**
1. At the flashing station, one key is generated per order and written to every
   radio in the pack (`flash_fleet.py --crew <order-id>`). The key is stored
   with the order in a private file that is never committed.
2. The crew member pairs in the app. The config drain shows a primary channel
   `RNDVU` whose key isn't the old Model 1 key, so the app **adopts that key as
   the crew** and does not overwrite it.
3. Pairing still writes region, battery reports and the name, in the single
   transaction from #13. The channel write is skipped or rewritten with the
   same key.

Each person in a 3-radio pack ends up in the same crew without seeing a key.
The printed card's QR (path 3) is the backup.

**2. Create a crew (own-it kits, friends forming a crew on the spot).**
1. The first person taps "Start a crew". The app generates 32 bytes from a
   secure random source and writes them to the radio during pairing.
2. Everyone else joins with path 3.

**3. Join by QR or link.**
- Any crew member can show "Invite to crew", which is a QR plus a share link.
  Everyone holds the key, so anyone can invite. That covers late joiners.
- Scanning in RNDVU (or with the iPhone camera, once links work) shows "Join
  Ash's crew?" and then writes the key to the radio.
- If the phone already belongs to a different crew, it asks first:
  "Leave your current crew?"

### The invite payload

- Base: `ChannelSet` with the one `RNDVU` channel (name and key) plus the
  LoRa config (region US, LONG_FAST). This keeps it Meshtastic-compatible.
- RNDVU additions: crew display name (`n=`) and crew id (`c=`), carried in the
  **URL fragment**. Browsers and messaging apps never send a fragment to a
  server, so the key doesn't leave the phones.
- Two forms:
  - **QR (first):** scanned inside RNDVU. This needs a camera scanner
    (`expo-camera`), which is a new native dependency, so it means a new build.
  - **Link (later):** `https://<rndvu domain>/join#…`. This needs a domain and
    an apple-app-site-association file so iOS opens RNDVU. Until then, a link
    sent in iMessage can't open the app.
- Optional extra: "Show Meshtastic QR" for official-app users. It's the same
  key in `meshtastic.org/e/#` form.

### Joining, leaving and changing crews

- **Join or create** writes channel 0 (name `RNDVU`, crew key, precision 32).
  It uses the #13 transaction: one reboot.
- **Leave** puts the radio back on a crew of one with a new random key. The
  radio stays on RNDVU's frequency, so it keeps relaying for others.
- **Rekey** ("someone left with a radio") creates a new crew key and shows a
  new invite. Everyone has to rescan. There's no remote revoke: a radio with
  the old key can still read old-key traffic until the whole crew has moved.
- **Handoff** (a radio changes hands, a phone dies): the new phone pairs, the
  app sees the crew key on the radio and adopts it (path 1). It then only
  renames, which is one reboot. The old phone has to tap Release first, or it
  will reconnect.

### Map tags and the "community" channel

Crew-scope tags stay on channel 0, the crew key. The plan's "tag scope follows
the crew" is that.

Community tags (channel 1) were never set up. Options:
- **(a) Leave them out of Model 2 (recommended).**
- (b) A festival-wide `RNDVU-public` channel 1 with a published key. Every RNDVU
  user could see "water refill here" tags, at a cost of airtime and spam.

### Migration from Model 1

- Model 2 ships behind a flag on TestFlight (plan week 7). **Countdown runs on
  Model 1.**
- **Countdown privacy:** the Model 1 key is public, so a stranger with
  Meshtastic and the GitHub repo could read the crew's chat. Countdown
  therefore uses a one-off key from the build (decision 5).
- When Model 2 is on, a radio still on the Model 1 key is treated as having no
  crew: the user creates a crew or joins one. Remove `RNDVU_CHANNEL_PSK` once
  no supported build depends on it.

## Risks and limits

- **A lost radio leaks its crew's key** until the crew rekeys. That's
  acceptable for festival chat. Rental radios are wiped on return.
- **The key is in plain AsyncStorage on the phone.** It's also in plain flash
  on the radio, so secure storage on the phone doesn't add much. Revisit if
  RNDVU ever carries anything sensitive.
- **Nobody gets messages from before they joined.** The T-Echo can't run Store &
  Forward.
- **Shared frequency means shared airtime.** Every crew's traffic uses the same
  slot. That's good for relaying and bad for congestion at Coachella scale. The
  capacity study, due before Gate D, decides whether 240 radios fit and whether
  to cut position or battery intervals.
- **Hash collisions** between crews cost a wasted decrypt and are harmless. A
  wrong-key decrypt that happens to parse is astronomically unlikely, but the
  router should drop structured messages that don't parse.

## Testing

- **Unit (MockFirmware):** create, join, adopt-from-radio, leave and rekey
  flows; the invite encode/decode round trip, including a real Meshtastic URL
  fixture; and onboarding not overwriting a shipped radio's key.
- **Sim (real firmware):** a crew key round-trips through set_channel and the
  config drain, and adopt-from-radio works on real firmware. The sim passes
  decoded packets, so **it can't test isolation between crews.**
- **Hardware (needed):** crew A on 2 radios, crew B on 1 radio in between.
  - A's messages reach the far A radio through B.
  - B's phone shows nothing from A.
  - The official Meshtastic app with the crew's Meshtastic QR reads A's chat.

## Work breakdown

| Step | Size |
| --- | --- |
| Crew store and secure random key (`expo-crypto`, new native dependency) | S |
| Codec: keep the PSK from the config drain (today only a fingerprint), and encode/decode `ChannelSet` | S |
| Pairing: adopt a crew key already on the radio; create and join paths | M |
| Invite screen (QR plus share) and scanner (`expo-camera`) | M |
| Leave and rekey | S |
| `flash_fleet.py --crew`: generate the order key and provision the pack over serial | M |
| Feature flag, migration, tests (unit, sim, hardware checklist) | M |

## Decisions (Oct 20, 2026)

1. **One shared frequency for all RNDVU crews.** Accepted: the channel name is
   always `RNDVU`.
2. **Shipped packs are pre-keyed at flashing time.** Accepted.
3. **QR first.** Accepted. The domain is being registered this week; links and
   the apple-app-site-association file follow once it exists.
4. **Community tags are left out of Model 2.** Accepted.
5. **Countdown gets a one-off key**, delivered as an EAS secret
   (`EXPO_PUBLIC_RNDVU_CHANNEL_PSK`, 32 bytes as base64) and baked into the
   Countdown build. It is never committed.
   - A build without the secret falls back to the Model 1 key, so dev builds
     keep working.
   - Radios paired by the Countdown build won't talk to dev-build radios.
   - The secret is generated with a command run on Charles's machine, so the
     key never appears in a chat transcript.
   - The key is still extractable from the app bundle by someone who has the
     build. That's acceptable for a TestFlight-only crew of 6.
6. **A Meshtastic-app QR.** Included.
