import { describe, test, expect, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

import { routeFromRadio, onMeshMessage } from './PacketRouter';
import { PortNum } from '../../types/mesh';
import type { FromRadio } from '../../types/mesh';
import type { Message } from '../../types/messages';
import { useCrewStore } from '../../store/useCrewStore';
import { useMessagesStore } from '../../store/useMessagesStore';

const ME = 0x5e6f7a;
const PEER = 0xa1b2c3;
let nextId = 1000;

function textPacket(text: string, id = nextId++): FromRadio {
  return {
    packet: {
      from: PEER,
      to: 0xffffffff,
      channel: 0,
      id,
      rxTime: Math.floor(Date.now() / 1000),
      decoded: { portnum: PortNum.TEXT_MESSAGE_APP, payload: new TextEncoder().encode(text) },
    },
  } as FromRadio;
}

describe('PacketRouter onMeshMessage', () => {
  test('fires once per chat-visible message, with the crew display name', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useCrewStore.getState().upsertMember({
      nodeId: PEER, longName: 'Maya', shortName: 'MAYA', lastHeard: Math.floor(Date.now() / 1000),
    });
    const seen: Message[] = [];
    const off = onMeshMessage(m => seen.push(m));

    const sos = textPacket('MF:!:34.0700,-117.2700');
    routeFromRadio(textPacket('hello'), ME);
    routeFromRadio(sos, ME);
    routeFromRadio(sos, ME); // flood duplicate: same packet id
    routeFromRadio(textPacket('MF:K:#ff00aa'), ME); // colour: ambient, not a message
    routeFromRadio(textPacket('MF:U:stage:artist'), ME); // un-going: ambient

    expect(seen.map(m => m.type)).toEqual(['text', 'sos']);
    expect(seen[0].fromName).toBe('Maya');

    off();
    routeFromRadio(textPacket('after unsubscribe'), ME);
    expect(seen).toHaveLength(2);
  });

  test('legacy MF:C (Beacon map calibration) from an old build is dropped, not shown as text', () => {
    const seen: Message[] = [];
    const off = onMeshMessage(m => seen.push(m));
    const before = useMessagesStore.getState().messages.length;
    expect(() => routeFromRadio(textPacket('MF:C:33.680000,-116.240000:33.670000,-116.230000'), ME)).not.toThrow();
    expect(seen).toEqual([]);
    expect(useMessagesStore.getState().messages.length).toBe(before);
    off();
  });

  test('a throwing listener does not break routing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const off1 = onMeshMessage(() => { throw new Error('boom'); });
    const seen: string[] = [];
    const off2 = onMeshMessage(m => seen.push(m.type));
    expect(() => routeFromRadio(textPacket('still routed'), ME)).not.toThrow();
    expect(seen).toEqual(['text']);
    off1(); off2();
  });
});
