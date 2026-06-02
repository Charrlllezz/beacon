import type { Message, TextMessage, HeadingMessage, RallyMessage, SOSMessage, GoingMessage, UngoingMessage, CalibrationMessage, ColorMessage, TagMessage, MeetupMessage } from '../../types/messages';
import type { GpsPoint, TagCategory } from '../../types/festival';

let _seq = 0;

// Runtime list mirroring the TagCategory union — used to detect whether an
// inbound MF:T payload carries a category segment (new format) or not (old).
const TAG_CATEGORIES: readonly TagCategory[] = ['stage', 'food', 'water', 'restroom', 'camp', 'custom'];

export function parseMessage(
  raw: string,
  fromNodeId: number,
  fromName: string,
  timestamp: number,
  channelIndex = 0
): Message {
  const id = `${fromNodeId}-${timestamp}-${_seq++}`;
  const base = { id, fromNodeId, fromName, timestamp, channelIndex };

  if (!raw.startsWith('MF:')) {
    return { ...base, type: 'text', text: raw } as TextMessage;
  }

  try {
    const parts = raw.split(':');
    const typeCode = parts[1];

    switch (typeCode) {
      case 'H': {
        const stageId = parts[2];
        if (!stageId) throw new Error('Missing stageId');
        return { ...base, type: 'heading', stageId } as HeadingMessage;
      }
      case 'R': {
        const payload = parts.slice(2).join(':');
        const noteIdx = payload.indexOf(':');
        const coords = noteIdx >= 0 ? payload.substring(0, noteIdx) : payload;
        const note = noteIdx >= 0 ? payload.substring(noteIdx + 1) : undefined;
        const [latStr, lngStr] = coords.split(',');
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isNaN(lat) || isNaN(lng)) throw new Error('Invalid coords');
        return { ...base, type: 'rally', lat, lng, note } as RallyMessage;
      }
      case '!': {
        const [latStr, lngStr] = parts[2].split(',');
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isNaN(lat) || isNaN(lng)) throw new Error('Invalid coords');
        return { ...base, type: 'sos', lat, lng } as SOSMessage;
      }
      case 'G': {
        const stageId = parts[2];
        const artistId = parts[3];
        if (!stageId || !artistId) throw new Error('Missing fields');
        return { ...base, type: 'going', stageId, artistId } as GoingMessage;
      }
      case 'U': {
        // Un-going: MF:U:<stageId>:<artistId> — peer deselected this pick.
        const stageId = parts[2];
        const artistId = parts[3];
        if (!stageId || !artistId) throw new Error('Missing fields');
        return { ...base, type: 'ungoing', stageId, artistId } as UngoingMessage;
      }
      case 'C': {
        const tlPart = parts[2];
        const brPart = parts[3];
        if (!tlPart || !brPart) throw new Error('Missing anchor parts');
        const [tlLat, tlLng] = tlPart.split(',').map(Number);
        const [brLat, brLng] = brPart.split(',').map(Number);
        if ([tlLat, tlLng, brLat, brLng].some(isNaN)) throw new Error('Invalid coords');
        return {
          ...base,
          type: 'calibration',
          anchors: {
            topLeft: { lat: tlLat, lng: tlLng },
            bottomRight: { lat: brLat, lng: brLng },
          },
        } as CalibrationMessage;
      }
      case 'K': {
        const color = parts[2];
        if (!color) throw new Error('Missing color');
        return { ...base, type: 'color', color } as ColorMessage;
      }
      case 'T': {
        // New: MF:T:<lat>,<lng>:<category>:<name>
        // Old: MF:T:<lat>,<lng>:<name>   (no category — defaults to 'custom')
        const coordPart = parts[2];
        const rest = parts.slice(3).join(':');
        if (!coordPart || !rest) throw new Error('Missing tag fields');
        const [latStr, lngStr] = coordPart.split(',');
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isNaN(lat) || isNaN(lng)) throw new Error('Invalid coords');
        const sepIdx = rest.indexOf(':');
        const head = sepIdx >= 0 ? rest.substring(0, sepIdx) : '';
        const hasCategory = (TAG_CATEGORIES as readonly string[]).includes(head);
        const category: TagCategory = hasCategory ? (head as TagCategory) : 'custom';
        const name = hasCategory ? rest.substring(sepIdx + 1) : rest;
        if (!name) throw new Error('Missing tag name');
        return { ...base, type: 'tag', lat, lng, name, category } as TagMessage;
      }
      case 'M': {
        // MF:M:<HH>:<MM>|<location>|<note>|<lat,lng>
        const hourStr = parts[2];
        const rest = parts.slice(3).join(':');
        const pipeParts = rest.split('|');
        const minuteStr = pipeParts[0];
        const location = pipeParts[1];
        const note = pipeParts[2] || undefined;
        const coordStr = pipeParts[3];
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minuteStr, 10);
        if (isNaN(hour) || isNaN(minute) || !location) throw new Error('Invalid meetup');
        const result: any = { ...base, type: 'meetup', hour, minute, location, note };
        if (coordStr) {
          const [latStr, lngStr] = coordStr.split(',');
          const lat = parseFloat(latStr);
          const lng = parseFloat(lngStr);
          if (!isNaN(lat) && !isNaN(lng)) { result.lat = lat; result.lng = lng; }
        }
        return result as MeetupMessage;
      }
      default:
        return { ...base, type: 'text', text: raw } as TextMessage;
    }
  } catch {
    return { ...base, type: 'text', text: raw } as TextMessage;
  }
}

export function buildHeadingMessage(stageId: string): string {
  return `MF:H:${stageId}`;
}

export function buildRallyMessage(lat: number, lng: number, note?: string): string {
  const coords = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  return note ? `MF:R:${coords}:${note.substring(0, 50)}` : `MF:R:${coords}`;
}

export function buildSOSMessage(lat: number, lng: number): string {
  return `MF:!:${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export function buildGoingMessage(stageId: string, artistId: string): string {
  return `MF:G:${stageId}:${artistId}`;
}

export function buildNotGoingMessage(stageId: string, artistId: string): string {
  return `MF:U:${stageId}:${artistId}`;
}

export function buildColorMessage(color: string): string {
  return `MF:K:${color}`;
}

export function buildCalibrationMessage(anchors: { topLeft: GpsPoint; bottomRight: GpsPoint }): string {
  const { topLeft: tl, bottomRight: br } = anchors;
  return `MF:C:${tl.lat.toFixed(6)},${tl.lng.toFixed(6)}:${br.lat.toFixed(6)},${br.lng.toFixed(6)}`;
}

export function buildTagMessage(lat: number, lng: number, name: string, category: TagCategory = 'custom'): string {
  return `MF:T:${lat.toFixed(4)},${lng.toFixed(4)}:${category}:${name.substring(0, 30)}`;
}

export function buildMeetupMessage(hour: number, minute: number, location: string, note?: string, lat?: number, lng?: number): string {
  const hh = hour.toString().padStart(2, '0');
  const mm = minute.toString().padStart(2, '0');
  // '|' is the meetup field delimiter — strip it from free text so a location
  // or note containing a pipe can't corrupt the wire format on the receiver.
  const safeLocation = location.replace(/\|/g, ' ');
  const safeNote = note ? note.substring(0, 40).replace(/\|/g, ' ') : '';
  let msg = `MF:M:${hh}:${mm}|${safeLocation}`;
  msg += `|${safeNote}`;
  if (lat != null && lng != null) msg += `|${lat.toFixed(4)},${lng.toFixed(4)}`;
  return msg;
}
