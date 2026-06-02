import { describe, test, expect } from 'vitest';
import {
  parseMessage,
  buildHeadingMessage,
  buildRallyMessage,
  buildSOSMessage,
  buildGoingMessage,
  buildNotGoingMessage,
  buildColorMessage,
  buildTagMessage,
  buildMeetupMessage,
} from './MessageService';

// parseMessage(raw, fromNodeId, fromName, timestamp, channelIndex)
const parse = (raw: string, channel = 0) => parseMessage(raw, 42, 'Tester', 1_700_000_000_000, channel);

describe('plain text', () => {
  test('non-MF text passes through untouched', () => {
    const m = parse('yo where you at?');
    expect(m.type).toBe('text');
    if (m.type === 'text') expect(m.text).toBe('yo where you at?');
  });

  test('base fields are populated', () => {
    const m = parse('hi');
    expect(m.fromNodeId).toBe(42);
    expect(m.fromName).toBe('Tester');
    expect(m.timestamp).toBe(1_700_000_000_000);
    expect(m.channelIndex).toBe(0);
  });
});

describe('heading / going / ungoing / color round-trips', () => {
  test('heading', () => {
    const m = parse(buildHeadingMessage('sahara'));
    expect(m.type).toBe('heading');
    if (m.type === 'heading') expect(m.stageId).toBe('sahara');
  });

  test('going', () => {
    const m = parse(buildGoingMessage('sahara', 'artist-1'));
    expect(m.type).toBe('going');
    if (m.type === 'going') {
      expect(m.stageId).toBe('sahara');
      expect(m.artistId).toBe('artist-1');
    }
  });

  test('ungoing (RSVP deselect)', () => {
    const m = parse(buildNotGoingMessage('sahara', 'artist-1'));
    expect(m.type).toBe('ungoing');
    if (m.type === 'ungoing') {
      expect(m.stageId).toBe('sahara');
      expect(m.artistId).toBe('artist-1');
    }
  });

  test('color', () => {
    const m = parse(buildColorMessage('#ff0000'));
    expect(m.type).toBe('color');
    if (m.type === 'color') expect(m.color).toBe('#ff0000');
  });
});

describe('rally / sos coordinate round-trips', () => {
  test('rally without note', () => {
    const m = parse(buildRallyMessage(33.6801, -116.2371));
    expect(m.type).toBe('rally');
    if (m.type === 'rally') {
      expect(m.lat).toBeCloseTo(33.6801, 4);
      expect(m.lng).toBeCloseTo(-116.2371, 4);
      expect(m.note).toBeUndefined();
    }
  });

  test('rally with a note containing a colon', () => {
    const m = parse(buildRallyMessage(33.68, -116.23, 'meet at 5:30 by the art'));
    expect(m.type).toBe('rally');
    if (m.type === 'rally') expect(m.note).toBe('meet at 5:30 by the art');
  });

  test('sos carries western-hemisphere (negative) longitude', () => {
    const m = parse(buildSOSMessage(33.68, -116.2378));
    expect(m.type).toBe('sos');
    if (m.type === 'sos') {
      expect(m.lat).toBeCloseTo(33.68, 4);
      expect(m.lng).toBeCloseTo(-116.2378, 4);
    }
  });
});

describe('tag category transmission', () => {
  test.each(['stage', 'food', 'water', 'restroom', 'camp', 'custom'] as const)(
    'round-trips category %s',
    (category) => {
      const m = parse(buildTagMessage(33.68, -116.23, 'Spot', category));
      expect(m.type).toBe('tag');
      if (m.type === 'tag') {
        expect(m.category).toBe(category);
        expect(m.name).toBe('Spot');
      }
    },
  );

  test('tag name containing a colon is preserved', () => {
    const m = parse(buildTagMessage(33.68, -116.23, 'Water: north gate', 'water'));
    expect(m.type).toBe('tag');
    if (m.type === 'tag') {
      expect(m.category).toBe('water');
      expect(m.name).toBe('Water: north gate');
    }
  });

  test('backward-compat: legacy MF:T with no category defaults to custom', () => {
    const m = parse('MF:T:33.6800,-116.2300:Old Spot');
    expect(m.type).toBe('tag');
    if (m.type === 'tag') {
      expect(m.category).toBe('custom');
      expect(m.name).toBe('Old Spot');
    }
  });
});

describe('meetup round-trips and delimiter safety', () => {
  test('meetup with stage location, note, and coords', () => {
    const m = parse(buildMeetupMessage(21, 30, 'sahara', 'link up!', 33.68, -116.23));
    expect(m.type).toBe('meetup');
    if (m.type === 'meetup') {
      expect(m.hour).toBe(21);
      expect(m.minute).toBe(30);
      expect(m.location).toBe('sahara');
      expect(m.note).toBe('link up!');
      expect(m.lat).toBeCloseTo(33.68, 4);
      expect(m.lng).toBeCloseTo(-116.23, 4);
    }
  });

  test('meetup without coords or note', () => {
    const m = parse(buildMeetupMessage(8, 0, 'Main Gate'));
    expect(m.type).toBe('meetup');
    if (m.type === 'meetup') {
      expect(m.hour).toBe(8);
      expect(m.minute).toBe(0);
      expect(m.location).toBe('Main Gate');
      expect(m.lat).toBeUndefined();
    }
  });

  test('pipes in location/note are stripped so the wire format is not corrupted', () => {
    const m = parse(buildMeetupMessage(20, 0, 'stage|left', 'by the|bar'));
    expect(m.type).toBe('meetup');
    if (m.type === 'meetup') {
      expect(m.location).toBe('stage left');
      expect(m.note).toBe('by the bar');
    }
  });
});

describe('malformed payloads fall back to text instead of throwing', () => {
  test.each([
    'MF:R:not-coords',
    'MF:!:abc,def',
    'MF:G:onlystage',
    'MF:M:notanumber|loc',
    'MF:Z:unknown-type-code',
  ])('"%s" becomes a text message', (raw) => {
    const m = parse(raw);
    expect(m.type).toBe('text');
    if (m.type === 'text') expect(m.text).toBe(raw);
  });
});
