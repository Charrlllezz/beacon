import { RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK } from '../ble/MeshtasticCodec';
import { CREW_CHANNEL_PSK } from '../../config/channelKey';
import { makeCrew, type Crew } from '../../store/useCrewKeyStore';
import { CREW_KEY_BYTES } from './invite';

// Which key pairing (and Re-provision) writes to the radio's RNDVU channel.

export type KeyPlan =
  | { kind: 'write'; psk: Uint8Array; adopt?: Crew }  // write this key (adopting the radio's crew first, if set)
  | { kind: 'choose' };                               // Model 2, no crew yet: the user starts or joins one

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * - Model 2 off: this build's key (the Countdown key, or Model 1).
 * - Model 2 on, phone already in a crew: that crew's key.
 * - Model 2 on, no crew, and the radio came pre-keyed (an RNDVU channel with
 *   a 32-byte key that isn't a shared build key): adopt the radio's crew. This
 *   is the shipped-pack path, with nothing to type or scan.
 * - Otherwise: ask (start a crew, or scan an invite).
 */
export function planChannelKey(opts: {
  model2: boolean;
  crew: Crew | null;
  radio: { name?: string; psk?: Uint8Array } | null;
}): KeyPlan {
  if (!opts.model2) return { kind: 'write', psk: CREW_CHANNEL_PSK };
  if (opts.crew) return { kind: 'write', psk: opts.crew.psk };
  const psk = opts.radio?.psk;
  const preKeyed = opts.radio?.name === RNDVU_CHANNEL_NAME
    && psk !== undefined
    && psk.length === CREW_KEY_BYTES
    && !sameKey(psk, RNDVU_CHANNEL_PSK)
    && !sameKey(psk, CREW_CHANNEL_PSK);
  if (preKeyed) {
    const adopt = makeCrew(psk!, 'radio');
    return { kind: 'write', psk: adopt.psk, adopt };
  }
  return { kind: 'choose' };
}
