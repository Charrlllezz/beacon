# The private Countdown key

The default channel key is compiled into this public repo, so anyone can read
it. Countdown NYE uses a one-off private key instead. It's baked into the EAS
build from an environment variable and never committed.

- Variable: `EXPO_PUBLIC_RNDVU_CHANNEL_PSK`, 32 random bytes as base64.
- Read by `src/config/channelKey.ts`. Pairing, Re-provision and the automatic
  re-provision after a factory reset all write this key.
- A build without it falls back to the public key, so local and dev builds keep
  working.
- An EAS build with a malformed value fails at `eas-build-post-install`
  (`scripts/check-channel-key.js`).

## Set it (once, on your machine)

You need the EAS CLI and a login. From Claude Code, `npx eas-cli login`
can't prompt; use `npx eas-cli login --device` instead. In bash (Git Bash or
Claude Code's `!`), from the repo:

```bash
MSYS_NO_PATHCONV=1 NPM_CONFIG_LOGLEVEL=warn npx eas-cli env:create --name EXPO_PUBLIC_RNDVU_CHANNEL_PSK --value "$(openssl rand -base64 32)" --environment production --environment preview --visibility sensitive --non-interactive
```

The key comes from the OS's secure random source, goes straight to EAS, and is
never printed. `sensitive` hides it in the EAS dashboard and logs. EAS doesn't
allow `secret` for `EXPO_PUBLIC_` variables, because they end up in the app
bundle.

Both prefixes matter:
- `NPM_CONFIG_LOGLEVEL=warn` stops `npx` echoing the whole command line, key
  included (`npm notice run eas env:create ... --value <key>`).
- `MSYS_NO_PATHCONV=1` stops Git Bash rewriting a key that starts with `/` into
  `C:/Program Files/Git/...`. The build check rejects that, but only at build
  time.

To check it without printing it, run
`EXPO_PUBLIC_RNDVU_CHANNEL_PSK="$(...)" node scripts/check-channel-key.js`
on the value from `eas env:list production --include-sensitive`, or just start
the build and read the log line below.

Then build as usual (`npx eas-cli build -p ios --profile production`). The build
log shows `EXPO_PUBLIC_RNDVU_CHANNEL_PSK OK: this build uses a private channel
key.`

## What the crew sees

- **Device sheet → Channel key** shows the radio's key fingerprint and
  `(private)` when it matches this build.
- If a radio was paired by another build, it shows `— not this crew's key` in
  red, and **Re-provision Device** gets a ⚠. Tapping it writes the Countdown key
  (one reboot).
- Radios on different keys can't read each other. Everyone in the crew must be
  on the same TestFlight build.

## Limits

- Anyone who has the Countdown build can pull the key out of the app bundle.
  That's acceptable for a TestFlight crew of 6, but it isn't Model 2.
- Rotating the key: run the same command with `env:update --variable-name
  EXPO_PUBLIC_RNDVU_CHANNEL_PSK --variable-environment production --value ...`
  (one variable covers both environments), rebuild, and have everyone tap
  Re-provision.
- After Countdown, Model 2 (per-crew keys) replaces this. See
  `docs/design/model-2-crew-keys.md`.
