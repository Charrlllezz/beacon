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

// Demo Saturday-night crew picks, there from launch (not trickled in over
// chat). Last year's W2 set times: GIVEON and SOMBR are live at 7:30 PM.
const ALEX = { nodeId: 0x1a2b3c, nodeName: 'Alex' };
const SAM = { nodeId: 0x2b3c4d, nodeName: 'Sam' };
const JORD = { nodeId: 0x3c4d5e, nodeName: 'Jord' };
const MIA = { nodeId: 0x4d5e6f, nodeName: 'Mia' };
const KAI = { nodeId: 0x5e6f80, nodeName: 'Kai' };
const PRIYA = { nodeId: 0x6f8091, nodeName: 'Priya' };
const PICKS: Array<[stageId: string, artistId: string, crew: typeof ALEX[]]> = [
  ['main', 'giveon', [ALEX, MIA]],
  ['outdoor', 'sombr', [PRIYA, KAI]],
  ['outdoor', 'labrinth', [PRIYA, MIA]],
  ['mojave', 'pinkpantheress', [SAM, PRIYA]],
  ['main', 'the-strokes', [MIA, ALEX, SAM]],
  ['sahara', 'rezz', [KAI, JORD, SAM, PRIYA]],
  ['quasar', 'david-guetta', [JORD, KAI]],
  ['yuma', 'boys-noize', [KAI]],
  ['main', 'justin-bieber', [ALEX, SAM, JORD, MIA, KAI, PRIYA]],
];
export const DEMO_GOING_ENTRIES = PICKS.flatMap(([stageId, artistId, crew]) =>
  crew.map(c => ({ ...c, stageId, artistId, timestamp: LAUNCHED_AT })));
export const DEMO_MY_PICKS = [
  { stageId: 'main', artistId: 'the-strokes' },
  { stageId: 'main', artistId: 'justin-bieber' },
];
