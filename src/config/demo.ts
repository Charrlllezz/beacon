// Pitch demo build: `eas build --profile demo` sets EXPO_PUBLIC_RNDVU_DEMO=1.
// The app runs on the simulated radio with a crew at Coachella, puts "me" on
// the grounds instead of wherever the phone is, and starts each launch with
// an empty chat so the scene's messages arrive live. Never on in a real build.
export const DEMO = process.env.EXPO_PUBLIC_RNDVU_DEMO === '1';

export const DEMO_FESTIVAL_ID = 'coachella-w2-2026';

// Between the Main stage and the art walk, a short walk from the mock crew.
export const DEMO_LOCATION = { lat: 33.6801, lng: -116.2372 };

// The Lineup's clock: last year's Coachella W2 Saturday at 7:30 PM, running
// forward from launch, so the tab shows what's LIVE and the rest of tonight.
const LAUNCHED_AT = Date.now();
const DEMO_LINEUP_START = Date.parse('2026-04-18T19:30:00-07:00');
export const DEMO_LINEUP_DAY = 1; // Sat

export function lineupNow(now: number): number {
  return DEMO ? DEMO_LINEUP_START + (now - LAUNCHED_AT) : now;
}
