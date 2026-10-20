import { describe, test, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { frame, FrameParser } from './streamFraming';
import { SimMesh, SIMULATOR_APP } from './SimMesh';
import { getField, lenField, splitFields, varField, varintOf } from './wire';
import {
  encodeFromRadioConfigComplete,
  encodeFromRadioMyInfo,
  encodeFromRadioPacket,
} from '../MeshtasticCodec';
import { PortNum } from '../../../types/mesh';

// Unit tests for the firmware-sim harness plumbing, against tiny fake
// meshtasticd TCP servers. The real-firmware suite is firmware.sim.ts.

describe('stream framing', () => {
  test('round-trips a frame split across chunks', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const bytes = frame(payload);
    expect([...bytes.slice(0, 4)]).toEqual([0x94, 0xc3, 0, 5]);
    const p = new FrameParser();
    expect(p.push(bytes.slice(0, 3))).toEqual([]);
    expect(p.push(bytes.slice(3))).toEqual([payload]);
  });

  test('skips debug text between frames and parses back-to-back frames', () => {
    const a = frame(new Uint8Array([7]));
    const b = frame(new Uint8Array([8, 9]));
    const text = new TextEncoder().encode('INFO | boot\n');
    const p = new FrameParser();
    const all = new Uint8Array([...text, ...a, ...text, ...b]);
    expect(p.push(all)).toEqual([new Uint8Array([7]), new Uint8Array([8, 9])]);
  });
});

/** Minimal stand-in for one meshtasticd --sim node. */
class FakeNode {
  server: net.Server;
  port = 0;
  sock: net.Socket | null = null;
  received: Uint8Array[] = [];

  constructor(readonly nodeNum: number) {
    this.server = net.createServer(sock => {
      this.sock = sock;
      const parser = new FrameParser();
      sock.on('data', (chunk: Buffer) => {
        for (const f of parser.push(new Uint8Array(chunk))) {
          this.received.push(f);
          const cfg = varintOf(getField(f, 3));
          if (cfg !== undefined) {
            this.send(encodeFromRadioMyInfo({ myNodeNum: this.nodeNum }));
            this.send(encodeFromRadioConfigComplete(cfg));
          }
        }
      });
    });
  }

  listen(): Promise<void> {
    return new Promise(r => this.server.listen(0, '127.0.0.1', () => {
      this.port = (this.server.address() as net.AddressInfo).port;
      r();
    }));
  }

  send(fromRadio: Uint8Array): void {
    this.sock!.write(frame(fromRadio));
  }

  /** Emit a "transmission" the way --sim firmware does. */
  transmit(portnum: number, payload: Uint8Array, id: number): void {
    const compressed = new Uint8Array([...varField(1, portnum), ...lenField(2, payload)]);
    this.send(encodeFromRadioPacket({
      from: this.nodeNum, to: 0xffffffff, channel: 0, id,
      decoded: { portnum: SIMULATOR_APP, payload: compressed },
    }));
  }

  /** ToRadio packets this node got from the harness. */
  packetsIn(): Uint8Array[] {
    return this.received.map(f => getField(f, 1)?.value).filter((v): v is Uint8Array => !!v);
  }

  close(): void {
    this.sock?.destroy();
    this.server.close();
  }
}

describe('SimMesh relay', () => {
  let nodes: FakeNode[] = [];
  let mesh: SimMesh | null = null;

  afterEach(() => {
    mesh?.stop();
    nodes.forEach(n => n.close());
    nodes = [];
    mesh = null;
  });

  async function setup(links: Array<[string, string]> | 'all') {
    nodes = [new FakeNode(0x10), new FakeNode(0x11), new FakeNode(0x12)];
    await Promise.all(nodes.map(n => n.listen()));
    mesh = new SimMesh(nodes.map((n, i) => ({ id: 'abc'[i], port: n.port })), links);
    await mesh.start(5000);
  }

  test('learns each node number from its config drain', async () => {
    await setup('all');
    expect(mesh!.nodeNum('a')).toBe(0x10);
    expect(mesh!.nodeNum('c')).toBe(0x12);
  });

  test('delivers a transmission to in-range nodes only, unwrapped in the air log', async () => {
    await setup([['a', 'b'], ['b', 'c']]);
    const text = new TextEncoder().encode('hi');
    nodes[0].transmit(PortNum.TEXT_MESSAGE_APP, text, 777);
    await mesh!.waitFor(() => nodes[1].packetsIn().length > 0, 2000, 'b receives');

    const [air] = mesh!.air;
    expect(air).toMatchObject({ txNode: 'a', from: 0x10, id: 777, portnum: PortNum.TEXT_MESSAGE_APP });
    expect([...air.payload]).toEqual([...text]);

    // b got the packet still wrapped as SIMULATOR_APP, which is what the
    // firmware unwraps on receive.
    const pkt = nodes[1].packetsIn()[0];
    const decoded = splitFields(pkt).find(f => f.field === 4)!.value;
    expect(varintOf(getField(decoded, 1))).toBe(SIMULATOR_APP);

    await new Promise(r => setTimeout(r, 100));
    expect(nodes[2].packetsIn()).toHaveLength(0); // c is out of a's range
    expect(nodes[0].packetsIn()).toHaveLength(0); // never echoed to the sender
  });

  test('hands frames to an attached app only after its own wantConfig', async () => {
    await setup('all');
    const got: Uint8Array[] = [];
    mesh!.attachPhone('a', { onFrame: b => got.push(b), onLinkDown: () => {} });

    nodes[0].send(encodeFromRadioMyInfo({ myNodeNum: 0x10 }));
    await new Promise(r => setTimeout(r, 100));
    expect(got).toHaveLength(0);

    mesh!.writeFromPhone('a', varField(3, 42));
    await mesh!.waitFor(() => got.length >= 2, 2000, 'app config drain');
    const completes = got.map(b => varintOf(getField(b, 7))).filter(v => v !== undefined);
    expect(completes).toEqual([42]);
  });

  test('tells the attached app when the node drops', async () => {
    await setup('all');
    let down = false;
    mesh!.attachPhone('b', { onFrame: () => {}, onLinkDown: () => { down = true; } });
    nodes[1].sock!.destroy();
    await mesh!.waitFor(() => down, 2000, 'link down');
    expect(mesh!.isUp('b')).toBe(false);
  });
});
