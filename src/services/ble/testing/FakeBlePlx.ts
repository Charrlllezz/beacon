// Test double for the slice of react-native-ble-plx that RealBleManager uses,
// backed by MockFirmware. Lets vitest drive RealBleManager's real connect /
// drain / reconnect logic without a phone: reads pop real FromRadio frames,
// writes feed real ToRadio bytes to the virtual radio, and FROM_NUM notifies
// fire when the firmware queues output (like hardware).
//
// Wire it up with:
//   vi.mock('react-native-ble-plx', () => import('./testing/FakeBlePlx'));

import { MockFirmware } from '../MockFirmware';
import { FROM_NUM_UUID, FROM_RADIO_UUID } from '../ConnectionState';

export const State = {
  Unknown: 'Unknown',
  Resetting: 'Resetting',
  Unsupported: 'Unsupported',
  Unauthorized: 'Unauthorized',
  PoweredOff: 'PoweredOff',
  PoweredOn: 'PoweredOn',
} as const;

const NOTIFY_LATENCY_MS = 5;
const CONNECT_LATENCY_MS = 20;

interface PendingConnect {
  id: string;
  resolve: (d: FakeDevice) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** The world the fake BLE stack sees: one radio, in range or not. */
class FakeWorld {
  firmware = new MockFirmware({ myNodeNum: 0x5e6f7a });
  deviceId = 'radio-1';
  inRange = true;
  /** Native link up. Can be true before JS connects (state restoration). */
  linkUp = false;
  connectCalls: Array<{ id: string; timeout?: number }> = [];
  restoreOptions: any = null;
  /** Hook run after each FROM_RADIO read, for interleaving tests. */
  afterRead: ((wasEmpty: boolean) => void) | null = null;
  pending: PendingConnect[] = [];
  disconnectListeners = new Set<() => void>();
  notifyListeners = new Set<() => void>();
  /** Monitor callbacks, for firing a notify synchronously (race tests). */
  monitorCallbacks = new Set<() => void>();
  /** Suppress the automatic notify on firmware output. */
  muteNotify = false;
  device = new FakeDevice(this);

  /** Radio walks out of range (or reboots): link drops, connects stall. */
  goOutOfRange(): void {
    this.inRange = false;
    if (this.linkUp) this.dropLink();
  }

  /** Radio is reachable again: any pending connect completes. */
  comeBackIntoRange(): void {
    this.inRange = true;
    const waiting = this.pending.splice(0);
    for (const p of waiting) {
      if (p.timer) clearTimeout(p.timer);
      setTimeout(() => { this.linkUp = true; p.resolve(this.device); }, CONNECT_LATENCY_MS);
    }
  }

  /** Deliver a FROM_NUM notify right now, e.g. while a read is in flight. */
  notifyNow(): void {
    this.monitorCallbacks.forEach(cb => cb());
  }

  dropLink(): void {
    this.linkUp = false;
    this.notifyListeners.clear();
    this.monitorCallbacks.clear();
    [...this.disconnectListeners].forEach(cb => cb());
  }
}

class FakeDevice {
  constructor(private w: FakeWorld) {}

  get id(): string { return this.w.deviceId; }

  async discoverAllServicesAndCharacteristics(): Promise<FakeDevice> {
    if (!this.w.linkUp) throw new Error('Device is not connected');
    return this;
  }

  monitorCharacteristicForService(_svc: string, char: string, cb: (err: Error | null, c: unknown) => void) {
    if (char !== FROM_NUM_UUID) return { remove() {} };
    const fire = () => setTimeout(() => cb(null, {}), NOTIFY_LATENCY_MS);
    const now = () => cb(null, {});
    const unsubFw = this.w.firmware.onOutputAvailable(() => {
      if (this.w.linkUp && !this.w.muteNotify) fire();
    });
    this.w.notifyListeners.add(fire);
    this.w.monitorCallbacks.add(now);
    return {
      remove: () => {
        unsubFw();
        this.w.notifyListeners.delete(fire);
        this.w.monitorCallbacks.delete(now);
      },
    };
  }

  async writeCharacteristicWithResponseForService(_svc: string, _char: string, base64: string) {
    if (!this.w.linkUp) throw new Error('Device is not connected');
    this.w.firmware.handleToRadio(fromBase64(base64));
    return {};
  }

  async readCharacteristicForService(_svc: string, char: string) {
    if (!this.w.linkUp) throw new Error('Device is not connected');
    if (char !== FROM_RADIO_UUID) return { value: null };
    const frame = this.w.firmware.getNextFromRadioFrame();
    this.w.afterRead?.(frame === null);
    return { value: frame ? toBase64(frame) : '' };
  }
}

export class BleManager {
  constructor(options?: any) {
    world.restoreOptions = options ?? null;
  }

  onStateChange(cb: (state: string) => void, emitCurrentState?: boolean) {
    if (emitCurrentState) queueMicrotask(() => cb(State.PoweredOn));
    return { remove() {} };
  }

  async isDeviceConnected(id: string): Promise<boolean> {
    return world.linkUp && id === world.deviceId;
  }

  async devices(ids: string[]): Promise<FakeDevice[]> {
    return ids.includes(world.deviceId) ? [world.device] : [];
  }

  connectToDevice(id: string, opts?: { timeout?: number }): Promise<FakeDevice> {
    const w = world;
    w.connectCalls.push({ id, timeout: opts?.timeout });
    return new Promise((resolve, reject) => {
      if (id !== w.deviceId) { reject(new Error('Device not found')); return; }
      if (w.inRange) {
        setTimeout(() => { w.linkUp = true; resolve(w.device); }, CONNECT_LATENCY_MS);
        return;
      }
      const p: PendingConnect = { id, resolve, reject, timer: null };
      if (opts?.timeout !== undefined) {
        p.timer = setTimeout(() => {
          w.pending = w.pending.filter(x => x !== p);
          reject(new Error('Operation timed out'));
        }, opts.timeout);
      }
      w.pending.push(p);
    });
  }

  async cancelDeviceConnection(id: string): Promise<void> {
    const w = world;
    const cancelled = w.pending.filter(p => p.id === id);
    w.pending = w.pending.filter(p => p.id !== id);
    for (const p of cancelled) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error('Operation was cancelled'));
    }
    if (w.linkUp && id === w.deviceId) w.dropLink();
  }

  onDeviceDisconnected(_id: string, cb: () => void) {
    world.disconnectListeners.add(cb);
    return { remove: () => { world.disconnectListeners.delete(cb); } };
  }

  startDeviceScan() {}
  stopDeviceScan() {}
  async enable() {}
}

// Declared after the classes: initializing it above them would hit the TDZ.
export let world = new FakeWorld();

export function resetWorld(): FakeWorld {
  world.firmware.reset();
  world = new FakeWorld();
  return world;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
