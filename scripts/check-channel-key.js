// EAS build hook (package.json "eas-build-post-install"): stop a build whose
// crew channel key is set but malformed, instead of shipping an app that
// quietly falls back to the public Model 1 key. Mirrors parseBuildKey in
// src/config/channelKey.ts. Never prints the key.
const value = process.env.EXPO_PUBLIC_RNDVU_CHANNEL_PSK;

if (!value) {
  console.log('EXPO_PUBLIC_RNDVU_CHANNEL_PSK not set: this build uses the public Model 1 channel key.');
  process.exit(0);
}

const b64 = value.trim().replace(/-/g, '+').replace(/_/g, '/');
const bytes = Buffer.from(b64, 'base64');
const roundTrips = bytes.toString('base64').replace(/=+$/, '') === b64.replace(/=+$/, '');

if (!roundTrips || bytes.length !== 32 || bytes.every(b => b === 0)) {
  console.error(`EXPO_PUBLIC_RNDVU_CHANNEL_PSK must be 32 random bytes in base64 (got ${bytes.length} bytes). Fix the EAS environment variable.`);
  process.exit(1);
}

console.log('EXPO_PUBLIC_RNDVU_CHANNEL_PSK OK: this build uses a private channel key.');
