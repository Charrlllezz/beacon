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

You need the EAS CLI and a login (`npx eas-cli login`). In PowerShell, from the
repo:

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
npx eas-cli env:create --name EXPO_PUBLIC_RNDVU_CHANNEL_PSK --value ([Convert]::ToBase64String($b)) --environment production --environment preview --visibility sensitive --non-interactive
Remove-Variable b
```

The key comes from the OS's secure random source, goes straight to EAS, and is
never printed. `sensitive` hides it in the EAS dashboard and logs. EAS doesn't
allow `secret` for `EXPO_PUBLIC_` variables, because they end up in the app
bundle.

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
- Rotating the key: run the command again with `env:update` instead of
  `env:create`, rebuild, and have everyone tap Re-provision.
- After Countdown, Model 2 (per-crew keys) replaces this. See
  `docs/design/model-2-crew-keys.md`.
