import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';

// The app's real RealBleManager, codec and PacketRouter against real Meshtastic
// firmware (meshtasticd, the pinned fleet version, in --sim mode). Three nodes
// in a chain a <-> b <-> c, so c only hears a through b.
//
// Run with `npm run test:sim` after `docker compose -f docker-compose.sim.yml
// up -d` (see docs/firmware-sim.md). Not part of `npm test`.

vi.mock('react-native-ble-plx', () => import('./TcpBlePlx'));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    multiRemove: async () => {},
  },
}));

import type { FromRadio } from '../../../types/mesh';
import { PortNum } from '../../../types/mesh';
import { SimMesh } from './SimMesh';
import { setSimMesh } from './TcpBlePlx';
import { lenField, concat, fixed32Field, varField } from './wire';
import { RealBleManager } from '../RealBleManager';
import { routeFromRadio } from '../PacketRouter';
import {
  decodePosition,
  decodeTextMessage,
  encodeData,
  encodePosition,
  encodeToRadio,
  POSITION_PRECISION_EXACT,
  RNDVU_CHANNEL_NAME,
  RNDVU_CHANNEL_PSK,
} from '../MeshtasticCodec';
import { FLEET_FIRMWARE } from '../../../utils/firmware';
import { useDeviceStore } from '../../../store/useDeviceStore';
import { useMessagesStore } from '../../../store/useMessagesStore';

const BROADCAST = 0xffffffff;
const ports = (process.env.SIM_PORTS ?? '4403,4404,4405').split(',').map(Number);
const host = process.env.SIM_HOST ?? '127.0.0.1';

let mesh: SimMesh;
let mgr: RealBleManager;
let packets: FromRadio[] = [];
let statuses: string[] = [];

function since(mark: number): FromRadio[] {
  return packets.slice(mark);
}

/** Connect the app to a node and wait for the config drain to finish. */
async function connectApp(id: string): Promise<void> {
  useDeviceStore.getState().disconnect();
  await mgr.connect(id, { autoRetry: true });
}

/**
 * Run an admin step that reboots the radio, then wait for the reboot and the
 * app's reconnect + config drain. Returns the packet index the new drain starts at.
 */
async function rebootingStep(id: string, step: () => Promise<void>): Promise<number> {
  statuses = [];
  const mark = packets.length;
  await step();
  await mesh.waitFor(
    () => statuses.includes('reconnecting') &&
      since(mark).some(p => p.configCompleteId !== undefined) &&
      statuses.at(-1) === 'connected',
    90000,
    `${id} to reboot and the app to reconnect`,
  );
  return mark;
}

/** The app's pairing step; the radio reboots at the end of it. */
async function provision(id: string): Promise<number> {
  await connectApp(id);
  return rebootingStep(id, () => mgr.setChannel(0, RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK));
}

function textsFrom(id: string, from: number): string[] {
  return mesh.node(id).log
    .map(e => e.msg.packet)
    .filter(p => p?.from === from && p.decoded?.portnum === PortNum.TEXT_MESSAGE_APP)
    .map(p => decodeTextMessage(p!.decoded!.payload));
}

function positionsFrom(id: string, from: number) {
  return mesh.node(id).log
    .map(e => e.msg.packet)
    .filter(p => p?.from === from && p.decoded?.portnum === PortNum.POSITION_APP)
    .map(p => decodePosition(p!.decoded!.payload));
}

/** A MeshPacket ToRadio the way a phone app writes one (firmware fills in from/id). */
function phonePacket(to: number, portnum: number, payload: Uint8Array, wantResponse = false): Uint8Array {
  return lenField(1, concat(
    fixed32Field(2, to),
    varField(3, 0),
    lenField(4, encodeData(portnum, payload, wantResponse)),
  ));
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mesh = new SimMesh(
    [{ id: 'a', host, port: ports[0] }, { id: 'b', host, port: ports[1] }, { id: 'c', host, port: ports[2] }],
    [['a', 'b'], ['b', 'c']],
  );
  setSimMesh(mesh);
  await mesh.start(120000);
  mgr = new RealBleManager();
  mgr.onPacket(p => {
    packets.push(p);
    routeFromRadio(p, useDeviceStore.getState().myNodeNum);
  });
  mgr.onStatus(s => statuses.push(s));
});

afterAll(() => {
  mgr?.disconnect();
  mesh?.stop();
  setSimMesh(null);
});

describe(`RNDVU against meshtasticd ${FLEET_FIRMWARE} (sim)`, () => {
  test('config drain from real firmware decodes', async () => {
    const mark = packets.length;
    await connectApp('a');
    const drain = since(mark);
    expect(drain.find(p => p.metadata)?.metadata?.firmwareVersion).toMatch(new RegExp(`^${FLEET_FIRMWARE.replace(/\./g, '\\.')}`));
    expect(drain.find(p => p.myInfo)?.myInfo?.myNodeNum).toBe(mesh.nodeNum('a'));
    expect(drain.some(p => p.configCompleteId === 42)).toBe(true);
    expect(useDeviceStore.getState().myNodeNum).toBe(mesh.nodeNum('a'));
    mgr.disconnect();
  });

  test('pairing sets region US, the RNDVU channel with exact position precision, and disables channels 1-7', async () => {
    const mark = await provision('a');
    const drain = since(mark);

    expect(drain.find(p => p.config?.lora)?.config?.lora?.region).toBe(1);
    const channels = drain.map(p => p.channel).filter(c => c !== undefined);
    const primary = channels.find(c => c!.index === 0)!;
    expect(primary.role).toBe(1);
    expect(primary.settings?.name).toBe(RNDVU_CHANNEL_NAME);
    expect(primary.settings?.positionPrecision).toBe(POSITION_PRECISION_EXACT);
    for (let i = 1; i <= 7; i++) {
      const ch = channels.find(c => c!.index === i);
      expect(ch?.role ?? 0, `channel ${i}`).toBe(0);
    }
    expect(useDeviceStore.getState().channelName).toBe(RNDVU_CHANNEL_NAME);
    mgr.disconnect();
  });

  test('provision b and c, set names (setting a name reboots the radio)', async () => {
    // Firmware 2.7.26 reboots after set_owner outside an edit transaction
    // (AdminModule::saveChanges), so pairing is two reboots, and anything sent
    // in the few seconds after naming is lost.
    for (const [id, long, short] of [['b', 'Bea', 'BEA'], ['c', 'Cal', 'CAL']] as const) {
      await provision(id);
      await rebootingStep(id, () => mgr.setOwner(long, short));
      mgr.disconnect();
    }
    await connectApp('a');
    await rebootingStep('a', () => mgr.setOwner('Ash', 'ASH'));
  });

  test('a text from the app reaches b directly and c over two hops', async () => {
    const a = mesh.nodeNum('a');
    await mgr.sendText('meet at the ferris wheel');
    await mesh.waitFor(() => textsFrom('c', a).includes('meet at the ferris wheel'), 60000, 'text at c');
    expect(textsFrom('b', a)).toContain('meet at the ferris wheel');

    // c can't hear a, so what c got was b's rebroadcast.
    const relayed = mesh.air.filter(p => p.from === a && p.txNode === 'b' && p.portnum === PortNum.TEXT_MESSAGE_APP);
    expect(relayed.length).toBeGreaterThan(0);
    expect(relayed[0].hopLimit).toBeLessThan(relayed[0].hopStart);
  });

  test('a text from c arrives in the app on a', async () => {
    const c = mesh.nodeNum('c');
    mesh.writeFromPhone('c', encodeToRadio(BROADCAST, 'where is everyone', c));
    await mesh.waitFor(
      () => useMessagesStore.getState().messages.some(m => m.fromNodeId === c && m.type === 'text' && m.text === 'where is everyone'),
      60000,
      'message in the app store',
    );
  });

  test('a position shared from the app reaches the crew at full precision', async () => {
    const a = mesh.nodeNum('a');
    // NOS Events Center, centre of the grounds.
    const pos = { latitudeI: 340866123, longitudeI: -1172917456, time: Math.floor(Date.now() / 1000) };
    mesh.writeFromPhone('a', phonePacket(BROADCAST, PortNum.POSITION_APP, encodePosition(pos)));
    await mesh.waitFor(() => positionsFrom('c', a).length > 0, 60000, 'position at c');
    const got = positionsFrom('c', a)[0];
    expect(got.latitudeI).toBe(pos.latitudeI);
    expect(got.longitudeI).toBe(pos.longitudeI);
  });

  test("the radio answers a crew member's position request with its exact position", async () => {
    // Firmware ≥2.7.24 answers from the channel's position_precision; with
    // none set it would send nothing (see PR #7).
    const a = mesh.nodeNum('a');
    const before = positionsFrom('b', a).length;
    const bPos = { latitudeI: 340870000, longitudeI: -1172910000, time: Math.floor(Date.now() / 1000) };
    mesh.writeFromPhone('b', phonePacket(a, PortNum.POSITION_APP, encodePosition(bPos), true));
    await mesh.waitFor(() => positionsFrom('b', a).length > before, 60000, "a's reply at b");
    const reply = positionsFrom('b', a).at(-1)!;
    expect(reply.latitudeI).toBe(340866123);
    expect(reply.longitudeI).toBe(-1172917456);
    // The reply went over the air addressed to b.
    expect(mesh.air.some(p => p.from === a && p.to === mesh.nodeNum('b') && p.portnum === PortNum.POSITION_APP)).toBe(true);
  });
});

