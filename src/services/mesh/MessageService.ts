import type { Message, TextMessage, HeadingMessage, RallyMessage, SOSMessage, GoingMessage, CalibrationMessage, ColorMessage } from '../../types/messages';
import type { GpsPoint } from '../../types/festival';

let _seq = 0;

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
      case 'C': {
        // MF:C:{tlLat},{tlLng}:{brLat},{brLng}
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

export function buildColorMessage(color: string): string {
  return `MF:K:${color}`;
}

export function buildCalibrationMessage(anchors: { topLeft: GpsPoint; bottomRight: GpsPoint }): string {
  const { topLeft: tl, bottomRight: br } = anchors;
  return `MF:C:${tl.lat.toFixed(6)},${tl.lng.toFixed(6)}:${br.lat.toFixed(6)},${br.lng.toFixed(6)}`;
}
