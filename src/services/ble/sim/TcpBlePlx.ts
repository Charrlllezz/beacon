// The slice of react-native-ble-plx that RealBleManager uses, backed by a node
// in a SimMesh (real firmware over TCP) instead of a radio over Bluetooth. Lets
// the sim suite run the app's real connect / config drain / provisioning code
// against real firmware. Device ids are SimMesh node ids.
//
//   vi.mock('react-native-ble-plx', () => import('./sim/TcpBlePlx'));
//   setSimMesh(mesh);
//
// Bluetooth itself (pacing, MTU, iOS background) is not modelled: a write is
// one ToRadio frame, a read pops one FromRadio frame, and FROM_NUM fires when a
// frame arrives, as the firmware does over BLE.

import { FROM_NUM_UUID, FROM_RADIO_UUID } from '../ConnectionState';
import type { SimMesh } from './SimMesh';

export const State = {
  Unknown: 'Unknown',
  Resetting: 'Resetting',
  Unsupported: 'Unsupported',
  Unauthorized: 'Unauthorized',
  PoweredOff: 'PoweredOff',
  PoweredOn: 'PoweredOn',
} as const;

let mesh: SimMesh | null = null;
const links = new Map<string, SimDevice>();
const disconnectListeners = new Map<string, Set<() => void>>();

export function setSimMesh(m: SimMesh | null): void {
  mesh = m;
  links.clear();
  disconnectListeners.clear();
}

function requireMesh(): SimMesh {
  if (!mesh) throw new Error('TcpBlePlx: call setSimMesh() first');
  return mesh;
}

function fireDisconnect(id: string): void {
  [...(disconnectListeners.get(id) ?? [])].forEach(cb => cb());
}

class SimDevice {
  queue: Uint8Array[] = [];
  notify = new Set<() => void>();
  linkUp = true;

  constructor(readonly id: string) {}

  async discoverAllServicesAndCharacteristics(): Promise<SimDevice> {
    if (!this.linkUp) throw new Error('Device is not connected');
    return this;
  }

  monitorCharacteristicForService(_svc: string, char: string, cb: (err: Error | null, c: unknown) => void) {
    if (char !== FROM_NUM_UUID) return { remove() {} };
    const fire = () => setTimeout(() => cb(null, {}), 0);
    this.notify.add(fire);
    return { remove: () => { this.notify.delete(fire); } };
  }

  async writeCharacteristicWithResponseForService(_svc: string, _char: string, base64: string) {
    if (!this.linkUp) throw new Error('Device is not connected');
    requireMesh().writeFromPhone(this.id, fromBase64(base64));
    return {};
  }

  async readCharacteristicForService(_svc: string, char: string) {
    if (!this.linkUp) throw new Error('Device is not connected');
    if (char !== FROM_RADIO_UUID) return { value: null };
    const f = this.queue.shift();
    return { value: f ? toBase64(f) : '' };
  }

  attach(): void {
    requireMesh().attachPhone(this.id, {
      onFrame: (bytes) => {
        this.queue.push(bytes);
        this.notify.forEach(n => n());
      },
      onLinkDown: () => this.drop(),
    });
  }

  drop(): void {
    if (!this.linkUp) return;
    this.linkUp = false;
    this.notify.clear();
    if (links.get(this.id) === this) links.delete(this.id);
    mesh?.detachPhone(this.id);
    fireDisconnect(this.id);
  }
}

interface Pending { id: string; cancel: () => void }
const pending = new Set<Pending>();

export class BleManager {
  constructor(_options?: unknown) {}

  onStateChange(cb: (state: string) => void, emitCurrentState?: boolean) {
    if (emitCurrentState) queueMicrotask(() => cb(State.PoweredOn));
    return { remove() {} };
  }

  async isDeviceConnected(id: string): Promise<boolean> {
    return links.get(id)?.linkUp ?? false;
  }

  async devices(ids: string[]): Promise<SimDevice[]> {
    return ids.map(id => links.get(id)).filter((d): d is SimDevice => !!d && d.linkUp);
  }

  /** Completes once the node's TCP API is up (e.g. after a reboot). */
  connectToDevice(id: string, opts?: { timeout?: number }): Promise<SimDevice> {
    const m = requireMesh();
    return new Promise((resolve, reject) => {
      if (!m.nodes.has(id)) { reject(new Error('Device not found')); return; }
      let done = false;
      const p: Pending = {
        id,
        cancel: () => finish(new Error('Operation was cancelled')),
      };
      const finish = (err: Error | null) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        if (timer) clearTimeout(timer);
        pending.delete(p);
        if (err) { reject(err); return; }
        const dev = new SimDevice(id);
        links.set(id, dev);
        dev.attach();
        resolve(dev);
      };
      const poll = setInterval(() => { if (m.isUp(id)) finish(null); }, 100);
      const timer = opts?.timeout !== undefined
        ? setTimeout(() => finish(new Error('Operation timed out')), opts.timeout)
        : null;
      pending.add(p);
      if (m.isUp(id)) finish(null);
    });
  }

  async cancelDeviceConnection(id: string): Promise<void> {
    for (const p of [...pending]) if (p.id === id) p.cancel();
    links.get(id)?.drop();
  }

  onDeviceDisconnected(id: string, cb: () => void) {
    if (!disconnectListeners.has(id)) disconnectListeners.set(id, new Set());
    disconnectListeners.get(id)!.add(cb);
    return { remove: () => { disconnectListeners.get(id)?.delete(cb); } };
  }

  startDeviceScan() {}
  stopDeviceScan() {}
  async enable() {}
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
