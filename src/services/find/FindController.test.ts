import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const sendText = vi.fn(async () => 1);
const requestPosition = vi.fn(async () => {});
vi.mock('../ble/BleManager', () => ({
  bleService: {
    sendText: (...a: unknown[]) => sendText(...(a as [])),
    requestPosition: (...a: unknown[]) => requestPosition(...(a as [])),
  },
}));

import {
  askToFind, cancelFind, finderDue, helperDue, receiveFind, receiveFindAnswer, startHelping, tickFind,
  HELP_MS, POSITION_REQUEST_EVERY_MS, REMIND_AFTER_MS, SEARCH_MS,
} from './FindController';
import { useFindStore } from '../../store/useFindStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import { parseMessage } from '../mesh/MessageService';
import type { FindAnswerMessage, FindMessage } from '../../types/messages';

const ME = 0xdbfc8747, SAM = 0x7ff333a8;
const T0 = 1_000_000;

const sent = () => sendText.mock.calls.map(c => (c as unknown[])[0]);

beforeEach(() => {
  sendText.mockClear();
  requestPosition.mockClear();
  useFindStore.setState({ outgoing: null, incoming: null, helping: null });
  useDeviceStore.setState({ myNodeNum: ME, status: 'connected' } as never);
  useCrewStore.setState({ myLocation: { lat: 34.0866, lng: -117.2917 }, myLocationIsPhone: true });
});

describe('messages', () => {
  test('round-trip: request, cancel, answer, live position', () => {
    const f = parseMessage('MF:F:7ff333a8', ME, 'Ash', 0) as FindMessage;
    expect([f.type, f.target, f.cancel]).toEqual(['find', SAM, false]);
    expect((parseMessage('MF:F:7ff333a8:0', ME, 'Ash', 0) as FindMessage).cancel).toBe(true);
    const a = parseMessage('MF:A:dbfc8747:1', SAM, 'Sam', 0) as FindAnswerMessage;
    expect([a.type, a.finder, a.helping]).toEqual(['findAnswer', ME, true]);
    expect(parseMessage('MF:P:34.08661,-117.29170', SAM, 'Sam', 0)).toMatchObject({ type: 'livePos', lat: 34.08661, lng: -117.2917 });
    expect(parseMessage('MF:A:zz:1', SAM, 'Sam', 0).type).toBe('text'); // garbage stays visible text
  });
});

describe('finder', () => {
  test('asking sends the request and asks their radio directly', async () => {
    expect(await askToFind(SAM, T0)).toBe(true);
    expect(sent()).toEqual(['MF:F:7ff333a8']);
    expect(requestPosition).toHaveBeenCalledWith(SAM, { lat: 34.0866, lng: -117.2917 });
    expect(useFindStore.getState().outgoing).toMatchObject({ target: SAM, positionAskedAt: T0, helping: null });
  });

  test('not connected: nothing is sent and no search starts', async () => {
    useDeviceStore.setState({ status: 'reconnecting' } as never);
    expect(await askToFind(SAM, T0)).toBe(false);
    expect(useFindStore.getState().outgoing).toBeNull();
  });

  test('reminds once after 2 minutes, re-asks the radio every 3, gives up at 10', () => {
    const o = { target: SAM, askedAt: T0, remindedAt: null, positionAskedAt: T0, helping: null };
    expect(finderDue(o, T0 + 60_000)).toEqual([]);
    expect(finderDue(o, T0 + REMIND_AFTER_MS)).toEqual(['remind']);
    expect(finderDue({ ...o, remindedAt: T0 + REMIND_AFTER_MS }, T0 + POSITION_REQUEST_EVERY_MS)).toEqual(['position']);
    expect(finderDue({ ...o, helping: true }, T0 + REMIND_AFTER_MS)).toEqual([]); // answered: no reminder
    expect(finderDue(o, T0 + SEARCH_MS)).toEqual(['expire']);
  });

  test('their answer shows up; an answer to someone else is ignored', async () => {
    await askToFind(SAM, T0);
    receiveFindAnswer(SAM, parseMessage('MF:A:12345678:1', SAM, 'Sam', 0) as FindAnswerMessage, ME);
    expect(useFindStore.getState().outgoing?.helping).toBeNull();
    receiveFindAnswer(SAM, parseMessage('MF:A:dbfc8747:1', SAM, 'Sam', 0) as FindAnswerMessage, ME);
    expect(useFindStore.getState().outgoing?.helping).toBe(true);
  });

  test('cancelling tells them to stop', async () => {
    await askToFind(SAM, T0);
    await cancelFind();
    expect(sent()).toEqual(['MF:F:7ff333a8', 'MF:F:7ff333a8:0']);
    expect(useFindStore.getState().outgoing).toBeNull();
  });
});

describe('helper', () => {
  const ask = (raw: string) => parseMessage(raw, ME, 'Ash', 0) as FindMessage;

  test('only the person named gets the request', () => {
    receiveFind(ME, 'Ash', ask('MF:F:12345678'), SAM, T0);
    expect(useFindStore.getState().incoming).toBeNull();
    receiveFind(ME, 'Ash', ask('MF:F:7ff333a8'), SAM, T0);
    expect(useFindStore.getState().incoming).toEqual({ finder: ME, finderName: 'Ash', at: T0 });
  });

  test('helping says yes, then sends phone GPS every 15 s, and stops after 10 minutes', async () => {
    useDeviceStore.setState({ myNodeNum: SAM } as never);
    await startHelping(ME, 'Ash', T0);
    expect(sent()).toEqual(['MF:A:dbfc8747:1', 'MF:P:34.08660,-117.29170']);
    expect(helperDue(useFindStore.getState().helping, T0 + 5_000)).toBe('none');
    expect(helperDue(useFindStore.getState().helping, T0 + 15_000)).toBe('live');

    await tickFind(T0 + HELP_MS);
    expect(useFindStore.getState().helping).toBeNull();
    expect(sent().at(-1)).toBe('MF:A:dbfc8747:0');
  });

  test("no live position from the radio's fix: the radio already broadcasts it", async () => {
    useCrewStore.setState({ myLocationIsPhone: false });
    await startHelping(ME, 'Ash', T0);
    expect(sent()).toEqual(['MF:A:dbfc8747:1']);
  });

  test('the finder calling it off stops helping without answering back', async () => {
    useDeviceStore.setState({ myNodeNum: SAM } as never);
    await startHelping(ME, 'Ash', T0);
    sendText.mockClear();
    receiveFind(ME, 'Ash', ask('MF:F:7ff333a8:0'), SAM, T0 + 1000);
    await Promise.resolve();
    expect(useFindStore.getState().helping).toBeNull();
    expect(sent()).toEqual([]);
  });
});
