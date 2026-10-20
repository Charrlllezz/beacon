// A small mesh of real meshtasticd processes (firmware built for Linux, run
// with --sim so its LoRa chip is simulated), with this harness standing in for
// the airwaves. Same model as Meshtasticator's interactive simulator:
//
// - In --sim mode a node doesn't transmit; it hands each outgoing radio packet
//   to its API client as a FromRadio packet with portnum SIMULATOR_APP (the
//   real portnum + payload wrapped in a Compressed message).
// - The client "delivers" it by writing that packet, as is, to each in-range
//   node's ToRadio. The firmware unwraps it and receives it as if over LoRa.
//
// meshtasticd allows one TCP client per node, so this class owns every node's
// connection and fans frames out: SIMULATOR_APP frames go to the relay, the
// rest go to the app under test (TcpBlePlx) when one is attached.
//
// Not modelled: encryption on the air (the sim hands over decoded packets, so
// two crews with different keys still "hear" each other here), RF timing and
// collisions, Bluetooth. Test those on hardware.

import * as net from 'node:net';
import { decodeFromRadio } from '../MeshtasticCodec';
import { PortNum } from '../../../types/mesh';
import type { FromRadio } from '../../../types/mesh';
import { frame, FrameParser } from './streamFraming';
import { concat, floatField, getField, lenField, splitFields, varField, varintOf, fixed32Of } from './wire';

export const SIMULATOR_APP = PortNum.SIMULATOR_APP;
const HARNESS_CONFIG_ID = 1;
const RECONNECT_MS = 500;

export interface SimNodeSpec {
  id: string;
  host?: string;
  port: number;
}

/** One packet a node put on the (simulated) air. */
export interface AirPacket {
  txNode: string;
  from: number;
  to: number;
  id: number;
  channel: number;
  hopLimit: number;
  hopStart: number;
  /** The real portnum and payload, unwrapped from the Compressed envelope. */
  portnum: number;
  payload: Uint8Array;
  wantResponse: boolean;
  at: number;
}

export interface PhoneLink {
  onFrame(bytes: Uint8Array): void;
  onLinkDown(): void;
}

class SimNode {
  socket: net.Socket | null = null;
  up = false;
  myNodeNum: number | null = null;
  /** Every non-relay FromRadio this node sent, decoded, for assertions. */
  log: Array<{ at: number; msg: FromRadio; raw: Uint8Array }> = [];
  phone: PhoneLink | null = null;
  /** Config id of the attached app's latest wantConfig since (re)connect. */
  phoneConfigId: number | null = null;
  private parser = new FrameParser();
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly spec: SimNodeSpec, private mesh: SimMesh) {}

  open(): void {
    if (this.mesh.stopped) return;
    const sock = net.createConnection({ host: this.spec.host ?? '127.0.0.1', port: this.spec.port });
    this.socket = sock;
    this.parser = new FrameParser();
    sock.on('connect', () => {
      this.up = true;
      this.phoneConfigId = null;
      // The firmware only streams to a client that asked for config.
      sock.write(frame(varField(3, HARNESS_CONFIG_ID)));
    });
    sock.on('data', (chunk: Buffer) => {
      for (const f of this.parser.push(new Uint8Array(chunk))) this.mesh.handleFrame(this, f);
    });
    sock.on('error', () => { /* 'close' follows */ });
    sock.on('close', () => {
      const wasUp = this.up;
      this.up = false;
      this.socket = null;
      if (wasUp) {
        const phone = this.phone;
        this.phone = null;
        phone?.onLinkDown();
      }
      if (!this.mesh.stopped) this.retry = setTimeout(() => this.open(), RECONNECT_MS);
    });
  }

  write(toRadio: Uint8Array): void {
    if (!this.socket || !this.up) throw new Error(`node ${this.spec.id} is down`);
    this.socket.write(frame(toRadio));
  }

  close(): void {
    if (this.retry) clearTimeout(this.retry);
    this.socket?.destroy();
  }
}

export class SimMesh {
  readonly nodes = new Map<string, SimNode>();
  readonly air: AirPacket[] = [];
  stopped = false;
  private links: Set<string> | 'all';
  private waiters = new Set<() => void>();

  /**
   * links: pairs of node ids that can hear each other, or 'all'. A chain
   * a-b, b-c makes a 2-hop path from a to c.
   */
  constructor(specs: SimNodeSpec[], links: Array<[string, string]> | 'all' = 'all') {
    for (const s of specs) this.nodes.set(s.id, new SimNode(s, this));
    this.links = links === 'all' ? 'all' : new Set(links.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  }

  /** Connect to every node and wait until each has reported its node number. */
  async start(timeoutMs = 60000): Promise<void> {
    for (const n of this.nodes.values()) n.open();
    await this.waitFor(() => [...this.nodes.values()].every(n => n.up && n.myNodeNum), timeoutMs, 'all nodes up');
  }

  stop(): void {
    this.stopped = true;
    for (const n of this.nodes.values()) n.close();
  }

  node(id: string): SimNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`no sim node ${id}`);
    return n;
  }

  nodeNum(id: string): number {
    const num = this.node(id).myNodeNum;
    if (!num) throw new Error(`node ${id} has not reported myInfo`);
    return num;
  }

  isUp(id: string): boolean {
    return this.nodes.get(id)?.up ?? false;
  }

  attachPhone(id: string, phone: PhoneLink): void {
    const n = this.node(id);
    if (!n.up) throw new Error(`node ${id} is down`);
    n.phone = phone;
    n.phoneConfigId = null;
  }

  detachPhone(id: string): void {
    const n = this.nodes.get(id);
    if (n) { n.phone = null; n.phoneConfigId = null; }
  }

  /** A ToRadio from the app under test (or a test acting as one). */
  writeFromPhone(id: string, toRadio: Uint8Array): void {
    const n = this.node(id);
    const wantConfig = varintOf(getField(toRadio, 3));
    if (wantConfig !== undefined) n.phoneConfigId = wantConfig;
    n.write(toRadio);
  }

  /** Resolve once pred() is true, re-checked whenever a frame arrives. */
  waitFor(pred: () => unknown, timeoutMs: number, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (pred()) { resolve(); return; }
      const check = () => {
        if (!pred()) return;
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`));
      }, timeoutMs);
      const poll = setInterval(check, 250); // for state that changes without a frame
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(poll);
        this.waiters.delete(check);
      };
      this.waiters.add(check);
    });
  }

  /** Called by SimNode for every complete frame. */
  handleFrame(node: SimNode, bytes: Uint8Array): void {
    const packetField = splitFields(bytes).find(f => f.field === 2);
    const msg = decodeFromRadio(bytes);
    if (packetField && msg.packet?.decoded?.portnum === SIMULATOR_APP) {
      this.relay(node, packetField.value, msg);
    } else {
      if (msg.myInfo) node.myNodeNum = msg.myInfo.myNodeNum;
      node.log.push({ at: Date.now(), msg, raw: bytes });
      // Hand to the app only after it asked for config on this connection, and
      // never the harness's own config-complete marker.
      const forPhone = node.phone && node.phoneConfigId !== null &&
        (msg.configCompleteId === undefined || msg.configCompleteId === node.phoneConfigId);
      if (forPhone) node.phone!.onFrame(bytes);
    }
    this.waiters.forEach(w => w());
  }

  private relay(tx: SimNode, packetBytes: Uint8Array, msg: FromRadio): void {
    const pf = splitFields(packetBytes);
    const inner = splitFields(msg.packet!.decoded!.payload); // Compressed { portnum=1, data=2 }
    const decodedField = pf.find(f => f.field === 4);
    const wantResponse = decodedField ? varintOf(splitFields(decodedField.value).find(f => f.field === 3)) === 1 : false;
    this.air.push({
      txNode: tx.spec.id,
      from: fixed32Of(pf.find(f => f.field === 1)) ?? 0,
      to: fixed32Of(pf.find(f => f.field === 2)) ?? 0,
      channel: varintOf(pf.find(f => f.field === 3)) ?? 0,
      id: fixed32Of(pf.find(f => f.field === 6)) ?? 0,
      hopLimit: varintOf(pf.find(f => f.field === 9)) ?? 0,
      hopStart: varintOf(pf.find(f => f.field === 15)) ?? 0,
      portnum: varintOf(inner.find(f => f.field === 1)) ?? 0,
      payload: inner.find(f => f.field === 2)?.value ?? new Uint8Array(0),
      wantResponse,
      at: Date.now(),
    });

    // Deliver the packet as is, plus a decent rx_snr (field 8; a later
    // occurrence of a field wins) so rebroadcast timing looks like real RF.
    const toRadio = lenField(1, concat(packetBytes, floatField(8, 8)));
    for (const rx of this.nodes.values()) {
      if (rx === tx || !rx.up) continue;
      if (this.links !== 'all' && !this.links.has(`${tx.spec.id}|${rx.spec.id}`)) continue;
      rx.write(toRadio);
    }
  }
}
