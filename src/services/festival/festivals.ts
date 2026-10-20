import type { FestivalConfig } from '../../types/festival';
import coachellaW2_2026 from '../../config/festivals/coachella-w2-2026.json';
import countdownNye2026 from '../../config/festivals/countdown-nye-2026.json';
import beyondWonderland2027 from '../../config/festivals/beyond-wonderland-2027.json';

// Every festival bundled into the build. Adding one = drop a JSON in
// src/config/festivals and list it here. FestivalSelection picks among them.
export const BUNDLED_FESTIVALS: FestivalConfig[] = [
  coachellaW2_2026 as FestivalConfig,
  countdownNye2026 as FestivalConfig,
  beyondWonderland2027 as FestivalConfig,
];

export function findFestival(id: string): FestivalConfig | undefined {
  return BUNDLED_FESTIVALS.find(c => c.festival.id === id);
}
