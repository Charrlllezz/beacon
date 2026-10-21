import {
  encodeChannelSet, decodeChannelSet, pskFingerprint,
  RNDVU_CHANNEL_NAME, POSITION_PRECISION_EXACT,
} from '../ble/MeshtasticCodec';

// Crew invites (Model 2). An invite is Meshtastic's ChannelSet: the one RNDVU
// channel (name and the crew's key) plus the LoRa settings. Two forms:
//
//   rndvu://join#v=1&cs=<ChannelSet>&n=<crew name>   RNDVU QR (the iPhone camera
//                                                    opens RNDVU from it too)
//   https://meshtastic.org/e/#<ChannelSet>           for the official app
//
// Everything after '#' is a fragment, which browsers and messaging apps never
// send to a server, so the key stays on the phones. The channel name is always
// RNDVU: it picks the frequency, and every crew sharing it is what lets crews
// relay for each other (docs/design/model-2-crew-keys.md).

export const CREW_KEY_BYTES = 32;
const LORA = { usePreset: true, modemPreset: 0 /* LONG_FAST */, region: 1 /* US */, hopLimit: 3, txEnabled: true };

export interface Invite {
  psk: Uint8Array;
  crewName?: string;
}

export function crewIdFor(psk: Uint8Array): string {
  return pskFingerprint(psk);
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array | null {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function channelSetFor(psk: Uint8Array): Uint8Array {
  return encodeChannelSet(
    [{ name: RNDVU_CHANNEL_NAME, psk, positionPrecision: POSITION_PRECISION_EXACT }],
    LORA,
  );
}

export function buildInviteUrl(psk: Uint8Array, crewName?: string): string {
  const params = [`v=1`, `cs=${toBase64Url(channelSetFor(psk))}`];
  if (crewName) params.push(`n=${encodeURIComponent(crewName.slice(0, 40))}`);
  return `rndvu://join#${params.join('&')}`;
}

export function buildMeshtasticUrl(psk: Uint8Array): string {
  return `https://meshtastic.org/e/#${toBase64Url(channelSetFor(psk))}`;
}

export type InviteError = 'not-an-invite' | 'not-rndvu' | 'bad-key';

/**
 * Read an RNDVU invite, or a Meshtastic channel link whose primary channel is
 * an RNDVU crew. Anything else is refused: joining a channel with another name
 * would move this radio to another frequency, away from every RNDVU crew.
 */
export function parseInvite(text: string): { ok: true; invite: Invite } | { ok: false; error: InviteError } {
  const s = text.trim();
  const hash = s.indexOf('#');
  if (hash < 0) return { ok: false, error: 'not-an-invite' };
  const head = s.slice(0, hash).toLowerCase();
  const fragment = s.slice(hash + 1);

  let cs: string | undefined;
  let crewName: string | undefined;
  if (head === 'rndvu://join' || /^https:\/\/[^/]+\/join\/?$/.test(head)) {
    for (const part of fragment.split('&')) {
      const eq = part.indexOf('=');
      const k = eq < 0 ? part : part.slice(0, eq);
      const v = eq < 0 ? '' : part.slice(eq + 1);
      if (k === 'cs') cs = v;
      if (k === 'n') { try { crewName = decodeURIComponent(v); } catch { crewName = undefined; } }
    }
  } else if (/^https:\/\/(www\.)?meshtastic\.org\/e\/?$/.test(head)) {
    cs = fragment.split(/[?&]/)[0];
  } else {
    return { ok: false, error: 'not-an-invite' };
  }
  if (!cs) return { ok: false, error: 'not-an-invite' };

  const bytes = fromBase64Url(cs);
  if (!bytes) return { ok: false, error: 'not-an-invite' };
  let primary;
  try {
    primary = decodeChannelSet(bytes).channels[0];
  } catch {
    return { ok: false, error: 'not-an-invite' };
  }
  if (!primary) return { ok: false, error: 'not-an-invite' };
  if (primary.name !== RNDVU_CHANNEL_NAME) return { ok: false, error: 'not-rndvu' };
  if (primary.psk.length !== CREW_KEY_BYTES || primary.psk.every(b => b === 0)) return { ok: false, error: 'bad-key' };
  return { ok: true, invite: { psk: primary.psk, crewName: crewName || undefined } };
}
