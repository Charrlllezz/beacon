import type { Message, TextMessage, HeadingMessage, RallyMessage, SOSMessage, GoingMessage, UngoingMessage, ColorMessage, TagMessage, MeetupMessage, ReplyMessage, ReplyKind, FindMessage, FindAnswerMessage, LivePosMessage } from '../../types/messages';
import { REPLY_KINDS } from '../../types/messages';
import type { TagCategory } from '../../types/festival';

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
      // 'C' (Beacon-era map calibration) is retired: it falls through to the
      // default text case here, and PacketRouter drops it before parsing.
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
      case 'Y': {
        // Reply: MF:Y:<kind>. What it answers travels in Data.reply_id.
        const kind = parts[2] as ReplyKind;
        if (!REPLY_KINDS.includes(kind)) throw new Error('Unknown reply');
        return { ...base, type: 'reply', kind } as ReplyMessage;
      }
      case 'F': {
        const target = parseInt(parts[2], 16);
        if (!parts[2] || isNaN(target)) throw new Error('Invalid find');
        return { ...base, type: 'find', target: target >>> 0, cancel: parts[3] === '0' } as FindMessage;
      }
      case 'A': {
        const finder = parseInt(parts[2], 16);
        if (!parts[2] || isNaN(finder) || (parts[3] !== '1' && parts[3] !== '0')) throw new Error('Invalid find answer');
        return { ...base, type: 'findAnswer', finder: finder >>> 0, helping: parts[3] === '1' } as FindAnswerMessage;
      }
      case 'P': {
        const [latStr, lngStr] = (parts[2] ?? '').split(',');
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isNaN(lat) || isNaN(lng)) throw new Error('Invalid coords');
        return { ...base, type: 'livePos', lat, lng } as LivePosMessage;
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

export function buildTagMessage(lat: number, lng: number, name: string, category: TagCategory = 'custom'): string {
  return `MF:T:${lat.toFixed(4)},${lng.toFixed(4)}:${category}:${name.substring(0, 30)}`;
}

// Find me: ask the crew radio's owner to help find them.
export function buildFindMessage(target: number, cancel = false): string {
  return `MF:F:${(target >>> 0).toString(16)}${cancel ? ':0' : ''}`;
}

export function buildFindAnswerMessage(finder: number, helping: boolean): string {
  return `MF:A:${(finder >>> 0).toString(16)}:${helping ? 1 : 0}`;
}

// Five decimals is ~1 m: as precise as phone GPS, still a short packet.
export function buildLivePosMessage(lat: number, lng: number): string {
  return `MF:P:${lat.toFixed(5)},${lng.toFixed(5)}`;
}

// Send with sendText(..., { replyId: <original packetId> }).
export function buildReplyMessage(kind: ReplyKind): string {
  return `MF:Y:${kind}`;
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
