import { defineConfig } from 'vitest/config';

// Real-firmware suite: the app's BLE/codec/router code against meshtasticd in
// Docker. See docs/firmware-sim.md. `npm test` does not run these.
export default defineConfig({
  test: {
    include: ['src/**/*.sim.ts'],
    testTimeout: 240_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
