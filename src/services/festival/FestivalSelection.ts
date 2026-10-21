import type { FestivalConfig, GpsPoint } from '../../types/festival';
import { haversineDistance } from '../../utils/coordinates';

// Within this distance of a venue we treat the user as "at" that venue. Wide
// enough to include parking, hotels and the drive in; NOS (San Bernardino) and
// Empire Polo (Indio) are ~100 km apart, so there's no ambiguity between them.
export const NEAR_VENUE_KM = 5;
// The active window opens before day one (arrival, camping, testing radios on
// site) and stays open after the last night (late sets, getting home).
const LEAD_MS = 2 * 24 * 3600 * 1000;
const TRAIL_MS = 1 * 24 * 3600 * 1000;

export type SelectionReason = 'override' | 'location' | 'date' | 'upcoming' | 'latest';

export interface Selection {
  config: FestivalConfig;
  reason: SelectionReason;
}

function windowOf(c: FestivalConfig): { start: number; end: number } {
  return {
    start: new Date(c.festival.dates.start).getTime() - LEAD_MS,
    end: new Date(c.festival.dates.end).getTime() + TRAIL_MS,
  };
}

function kmToVenue(c: FestivalConfig, p: GpsPoint): number {
  return haversineDistance(p.lat, p.lng, c.venue.center.lat, c.venue.center.lng) / 1000;
}

/**
 * Pick the festival to run. Location narrows first (if you're at a venue,
 * it's that venue's event; one venue can host several, like NOS). Then date:
 * an event whose window is open now, else the next one coming up, else the
 * most recent. An override (from the Device sheet) wins outright.
 */
export function pickFestival(
  configs: FestivalConfig[],
  now: Date,
  location: GpsPoint | null,
  overrideId: string | null = null,
): Selection {
  if (configs.length === 0) throw new Error('No festival configs bundled');
  if (overrideId) {
    const forced = configs.find(c => c.festival.id === overrideId);
    if (forced) return { config: forced, reason: 'override' };
  }

  const t = now.getTime();
  let pool = configs;
  let atVenue = false;
  if (location) {
    const near = configs.filter(c => kmToVenue(c, location) <= NEAR_VENUE_KM);
    if (near.length > 0) { pool = near; atVenue = true; }
  }

  const open = pool.filter(c => { const w = windowOf(c); return t >= w.start && t <= w.end; });
  if (open.length > 0) {
    // Overlapping windows (one event's trailing day, the next one's lead-in):
    // prefer the later event.
    const best = [...open].sort((a, b) => startOf(b) - startOf(a))[0];
    return { config: best, reason: atVenue ? 'location' : 'date' };
  }

  const upcoming = pool.filter(c => startOf(c) > t).sort((a, b) => startOf(a) - startOf(b));
  if (upcoming.length > 0) return { config: upcoming[0], reason: atVenue ? 'location' : 'upcoming' };

  const latest = [...pool].sort((a, b) => endOf(b) - endOf(a))[0];
  return { config: latest, reason: atVenue ? 'location' : 'latest' };
}

function startOf(c: FestivalConfig): number { return new Date(c.festival.dates.start).getTime(); }
function endOf(c: FestivalConfig): number { return new Date(c.festival.dates.end).getTime(); }

/** Calendar date (YYYY-MM-DD) of an instant in the festival's timezone. */
function localDateKey(ms: number, timeZone: string): string {
  // Built from parts rather than trusting a locale's date order (Hermes on
  // iOS formats through the platform).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Sets that start before 6am festival-local belong to the previous night.
const LATE_NIGHT_HOURS = 6;

/**
 * The festival day a set belongs to, as YYYY-MM-DD. Compares whole dates, so a
 * 1am set on Jan 1 lands on Dec 31 (the old day-of-month + 1 check broke at
 * month and year boundaries: 31 + 1 is never 1).
 */
export function festivalDayKey(iso: string, timeZone: string): string {
  return localDateKey(new Date(iso).getTime() - LATE_NIGHT_HOURS * 3600 * 1000, timeZone);
}

/** Day tabs for the lineup: one per festival calendar day, from the config dates. */
export function festivalDays(c: FestivalConfig): { key: string; label: string }[] {
  const tz = c.festival.timezone;
  const days: { key: string; label: string }[] = [];
  // dates.end is midnight after the last day. Sample each day at local noon
  // (24h hops from start + 12h), so a DST shift can't skip or repeat a day.
  for (let t = startOf(c) + 12 * 3600 * 1000; t < endOf(c) && days.length < 14; t += 24 * 3600 * 1000) {
    const label = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(t));
    days.push({ key: localDateKey(t, tz), label });
  }
  return days;
}
