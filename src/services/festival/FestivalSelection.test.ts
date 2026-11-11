import { describe, test, expect } from 'vitest';
import { pickFestival, festivalDays, festivalDayKey } from './FestivalSelection';
import { BUNDLED_FESTIVALS } from './festivals';
import { tilesForBounds } from '../map/tileMath';

const NOS = { lat: 34.0866, lng: -117.2917 };
const INDIO = { lat: 33.6803, lng: -116.2378 };
const LA = { lat: 34.0522, lng: -118.2437 }; // ~85 km from NOS
const at = (iso: string) => new Date(iso);
const pick = (iso: string, loc: { lat: number; lng: number } | null = null, override: string | null = null) =>
  pickFestival(BUNDLED_FESTIVALS, at(iso), loc, override);

describe('pickFestival', () => {
  test('Countdown NYE on Dec 31, by date alone', () => {
    const s = pick('2026-12-31T20:00:00-08:00');
    expect(s.config.festival.id).toBe('countdown-nye-2026');
    expect(s.reason).toBe('date');
  });

  test('NYE window covers the after-midnight hours and arrival two days early', () => {
    expect(pick('2027-01-01T03:00:00-08:00').config.festival.id).toBe('countdown-nye-2026');
    expect(pick('2026-12-29T12:00:00-08:00').config.festival.id).toBe('countdown-nye-2026');
  });

  test('between events: the next one coming up', () => {
    const s = pick('2026-10-19T12:00:00-07:00');
    expect(s.config.festival.id).toBe('countdown-nye-2026');
    expect(s.reason).toBe('upcoming');
    expect(pick('2027-02-10T12:00:00-08:00').config.festival.id).toBe('beyond-wonderland-2027');
  });

  test('at NOS, the venue narrows the pick and date chooses between its two events', () => {
    expect(pick('2026-11-15T12:00:00-08:00', NOS)).toMatchObject({
      config: { festival: { id: 'countdown-nye-2026' } }, reason: 'location',
    });
    expect(pick('2027-03-26T22:00:00-07:00', NOS).config.festival.id).toBe('beyond-wonderland-2027');
  });

  test('location wins over date: at Empire Polo during NYE week still means Coachella', () => {
    const s = pick('2026-12-31T20:00:00-08:00', INDIO);
    expect(s.config.festival.id).toBe('coachella-w2-2026');
    expect(s.reason).toBe('location');
  });

  test('far from every venue, location is ignored and date decides', () => {
    expect(pick('2026-12-31T20:00:00-08:00', LA).reason).toBe('date');
  });

  test('after everything: the most recent', () => {
    const s = pick('2027-09-01T12:00:00-07:00');
    expect(s.config.festival.id).toBe('beyond-wonderland-2027');
    expect(s.reason).toBe('latest');
  });

  test('a manual override wins; an unknown override is ignored', () => {
    expect(pick('2026-12-31T20:00:00-08:00', NOS, 'coachella-w2-2026')).toMatchObject({
      config: { festival: { id: 'coachella-w2-2026' } }, reason: 'override',
    });
    expect(pick('2026-12-31T20:00:00-08:00', null, 'gone-2025').config.festival.id).toBe('countdown-nye-2026');
  });
});

describe('festival days', () => {
  const byId = (id: string) => BUNDLED_FESTIVALS.find(c => c.festival.id === id)!;

  test('Coachella W2 keeps its Fri/Sat/Sun tabs', () => {
    expect(festivalDays(byId('coachella-w2-2026'))).toEqual([
      { key: '2026-04-17', label: 'Fri' },
      { key: '2026-04-18', label: 'Sat' },
      { key: '2026-04-19', label: 'Sun' },
    ]);
  });

  test('NYE is one day; Beyond Wonderland is Fri/Sat', () => {
    expect(festivalDays(byId('countdown-nye-2026'))).toEqual([{ key: '2026-12-31', label: 'Thu' }]);
    expect(festivalDays(byId('beyond-wonderland-2027')).map(d => d.label)).toEqual(['Fri', 'Sat']);
  });

  test('late-night sets belong to the previous night, across a year boundary', () => {
    const tz = 'America/Los_Angeles';
    expect(festivalDayKey('2027-01-01T01:30:00-08:00', tz)).toBe('2026-12-31');
    expect(festivalDayKey('2026-12-31T22:00:00-08:00', tz)).toBe('2026-12-31');
    expect(festivalDayKey('2027-01-01T07:00:00-08:00', tz)).toBe('2027-01-01');
    // Coachella's old behaviour is preserved: a midnight set on Sat goes to Fri.
    expect(festivalDayKey('2026-04-18T00:00:00-07:00', tz)).toBe('2026-04-17');
  });
});

describe('bundled configs', () => {
  test('each has sane dates, a center inside its bounds, and tile area containing the grounds', () => {
    for (const c of BUNDLED_FESTIVALS) {
      const { start, end } = c.festival.dates;
      expect(new Date(end).getTime()).toBeGreaterThan(new Date(start).getTime());
      const { center, bounds } = c.venue;
      expect(center.lat).toBeGreaterThan(bounds.sw.lat);
      expect(center.lat).toBeLessThan(bounds.ne.lat);
      expect(center.lng).toBeGreaterThan(bounds.sw.lng);
      expect(center.lng).toBeLessThan(bounds.ne.lng);
      const tb = c.venue.tileBounds ?? bounds;
      expect(tb.sw.lat).toBeLessThanOrEqual(bounds.sw.lat);
      expect(tb.ne.lat).toBeGreaterThanOrEqual(bounds.ne.lat);
      expect(tb.sw.lng).toBeLessThanOrEqual(bounds.sw.lng);
      expect(tb.ne.lng).toBeGreaterThanOrEqual(bounds.ne.lng);
    }
  });

  test('ids are unique', () => {
    const ids = BUNDLED_FESTIVALS.map(c => c.festival.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('tile areas: Coachella unchanged (2,746 tiles, as the README says); NOS a reasonable download', () => {
    const coachella = BUNDLED_FESTIVALS.find(c => c.festival.id === 'coachella-w2-2026')!;
    expect(tilesForBounds(coachella.venue.tileBounds!)).toHaveLength(2746);
    const nos = BUNDLED_FESTIVALS.find(c => c.festival.id === 'countdown-nye-2026')!;
    const n = tilesForBounds(nos.venue.tileBounds!).length;
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(2746);
  });
});

describe('bundled lineups', () => {
  // A set on a night the config's dates don't cover has no day tab and
  // silently never shows. Catches a lineup added without widening dates.
  test.each(BUNDLED_FESTIVALS.map(c => [c.festival.id, c] as const))('%s: every set lands on a day tab', (_id, c) => {
    const tabs = new Set(festivalDays(c).map(d => d.key));
    for (const stage of c.stages) {
      for (const slot of stage.schedule) {
        expect(tabs, `${stage.id} / ${slot.artistName} at ${slot.start}`).toContain(festivalDayKey(slot.start, c.festival.timezone));
      }
    }
  });
});
