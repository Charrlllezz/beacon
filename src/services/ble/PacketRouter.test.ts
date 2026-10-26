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
import { encodePosition } from './MeshtasticCodec';
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

  test('a position records when it was taken; an older replay does not overwrite it', () => {
    const now = Math.floor(Date.now() / 1000);
    useCrewStore.getState().upsertMember({ nodeId: PEER, longName: 'Maya', shortName: 'MAYA', lastHeard: now });
    const position = (latitudeI: number, time: number): FromRadio => ({
      packet: {
        from: PEER, to: 0xffffffff, channel: 0, id: nextId++, rxTime: now,
        decoded: { portnum: PortNum.POSITION_APP, payload: encodePosition({ latitudeI, longitudeI: -1172700000, time }) },
      },
    } as FromRadio);

    routeFromRadio(position(340700000, now - 120), ME);
    expect(useCrewStore.getState().crewMembers[PEER].locationAt).toBe(now - 120);

    // The radio's node DB replays a 40-minute-old fix on reconnect.
    routeFromRadio(position(340000000, now - 2400), ME);
    const m = useCrewStore.getState().crewMembers[PEER];
    expect(m.lat).toBeCloseTo(34.07, 4);
    expect(m.locationAt).toBe(now - 120);
  });

  test('replies keep their packet id and reply_id; a reply with no target is dropped', () => {
    const seen: Message[] = [];
    const off = onMeshMessage(m => seen.push(m));
    const reply = (replyId?: number): FromRadio => ({
      packet: {
        from: PEER, to: 0xffffffff, channel: 0, id: nextId++, rxTime: Math.floor(Date.now() / 1000),
        decoded: { portnum: PortNum.TEXT_MESSAGE_APP, payload: new TextEncoder().encode('MF:Y:omw'), replyId },
      },
    } as FromRadio);

    const withTarget = reply(0x4242);
    routeFromRadio(withTarget, ME);
    routeFromRadio(reply(undefined), ME);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'reply', kind: 'omw', replyTo: 0x4242, packetId: withTarget.packet!.id });
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

describe('PacketRouter Find me', () => {
  test("a request for me raises it, never shows in chat, and a live position moves the sender's pin", async () => {
    const { useFindStore } = await import('../../store/useFindStore');
    useCrewStore.getState().upsertMember({ nodeId: PEER, longName: 'Maya', shortName: 'MAYA', lastHeard: Math.floor(Date.now() / 1000) });
    const before = useMessagesStore.getState().messages.length;

    routeFromRadio(textPacket(`MF:F:${ME.toString(16)}`), ME);
    expect(useFindStore.getState().incoming).toMatchObject({ finder: PEER, finderName: 'Maya' });

    routeFromRadio(textPacket('MF:F:12345678'), ME); // someone else's search
    routeFromRadio(textPacket('MF:P:34.08661,-117.29170'), ME);
    expect(useCrewStore.getState().crewMembers[PEER]).toMatchObject({ lat: 34.08661, lng: -117.2917 });

    routeFromRadio(textPacket(`MF:F:${ME.toString(16)}:0`), ME); // called off
    expect(useFindStore.getState().incoming).toBeNull();
    expect(useMessagesStore.getState().messages.length).toBe(before);
  });
});
