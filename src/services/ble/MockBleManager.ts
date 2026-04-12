import type { FromRadio } from '../../types/mesh';
import { PortNum } from '../../types/mesh';

export type PacketCallback = (fromRadio: FromRadio) => void;
export type StatusCallback = (status: 'connected' | 'disconnected') => void;

// Simulated crew members — GPS positions spread across Coachella venue
const MOCK_CREW = [
  { nodeId: 0x1a2b3c, longName: 'Alex Rivera', shortName: 'Alex', lat: 33.6803, lng: -116.2378, battery: 82, snr: 10.5, color: '#e91e63' },
  { nodeId: 0x2b3c4d, longName: 'Sam Chen', shortName: 'Sam', lat: 33.6810, lng: -116.2365, battery: 45, snr: 6.2, color: '#2196f3' },
  { nodeId: 0x3c4d5e, longName: 'Jordan Park', shortName: 'Jord', lat: 33.6798, lng: -116.2355, battery: 11, snr: -2.0, color: '#00bcd4' },
  { nodeId: 0x4d5e6f, longName: 'Mia Santos', shortName: 'Mia', lat: 33.6795, lng: -116.2368, battery: 67, snr: 8.0, color: '#8bc34a' },
  { nodeId: 0x5e6f80, longName: 'Kai Thompson', shortName: 'Kai', lat: 33.6815, lng: -116.2345, battery: 93, snr: 12.0, color: '#9c27b0' },
  { nodeId: 0x6f8091, longName: 'Priya Sharma', shortName: 'Priy', lat: 33.6790, lng: -116.2380, battery: 34, snr: 1.5, color: '#ff5252' },
];

const MOCK_MESSAGES = [
  { from: 0x1a2b3c, text: 'yo where you at?', delay: 4000 },
  { from: 0x2b3c4d, text: 'MF:H:main', delay: 8000 },
  { from: 0x3c4d5e, text: 'meet me at the Do LaB?', delay: 14000 },
  { from: 0x4d5e6f, text: 'MF:R:33.6800,-116.2370:by the art walk', delay: 20000 },
  { from: 0x5e6f80, text: 'sahara tent is going off rn', delay: 26000 },
  { from: 0x1a2b3c, text: 'MF:T:33.6808,-116.2360:Water Station', delay: 30000 },
  { from: 0x6f8091, text: 'someone grab water pls', delay: 38000 },
  { from: 0x2b3c4d, text: 'this set is incredible', delay: 45000 },
  { from: 0x3c4d5e, text: 'MF:M:21:00|sahara|Let\'s link up!', delay: 55000 },
  { from: 0x5e6f80, text: 'heading to yuma in 10', delay: 65000 },
];

const MY_NODE_NUM = 0x5e6f7a;

export class MockBleManager {
  private packetCallback: PacketCallback | null = null;
  private statusCallback: StatusCallback | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private driftIntervals: ReturnType<typeof setInterval>[] = [];
  private isConnected = false;

  onPacket(cb: PacketCallback): () => void {
    this.packetCallback = cb;
    return () => { if (this.packetCallback === cb) this.packetCallback = null; };
  }
  onStatus(cb: StatusCallback): () => void {
    this.statusCallback = cb;
    return () => { if (this.statusCallback === cb) this.statusCallback = null; };
  }

  async scanAndConnect(): Promise<{ id: string; name: string }[]> {
    return [
      { id: 'mock-device-001', name: 'Meshtastic_ABCD' },
    ];
  }

  async connect(deviceId: string): Promise<void> {
    this.timers.forEach(clearTimeout);
    this.driftIntervals.forEach(clearInterval);
    this.timers = [];
    this.driftIntervals = [];

    await this.delay(1500);
    this.isConnected = true;
    this.statusCallback?.('connected');

    this.emit({
      myInfo: { myNodeNum: MY_NODE_NUM, hasGps: true, firmwareVersion: '2.3.14' },
    });

    await this.delay(500);
    for (const member of MOCK_CREW) {
      this.emit({
        nodeInfo: {
          num: member.nodeId,
          user: {
            id: `!${member.nodeId.toString(16)}`,
            longName: member.longName,
            shortName: member.shortName,
          },
          position: {
            latitudeI: Math.round(member.lat * 1e7),
            longitudeI: Math.round(member.lng * 1e7),
            time: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 120),
          },
          snr: member.snr,
          lastHeard: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 60),
          deviceMetrics: { batteryLevel: member.battery },
        },
      });
      await this.delay(200);
    }

    for (const member of MOCK_CREW) {
      this.emitText(member.nodeId, `MF:K:${member.color}`);
      await this.delay(100);
    }

    // Self node info (near Coachella Stage)
    this.emit({
      nodeInfo: {
        num: MY_NODE_NUM,
        user: { id: `!${MY_NODE_NUM.toString(16)}`, longName: 'You', shortName: 'You' },
        position: {
          latitudeI: Math.round(33.6805 * 1e7),
          longitudeI: Math.round(-116.2375 * 1e7),
          time: Math.floor(Date.now() / 1000),
        },
        lastHeard: Math.floor(Date.now() / 1000),
        deviceMetrics: { batteryLevel: 73 },
      },
    });

    this.emit({ configCompleteId: 42 });

    for (const msg of MOCK_MESSAGES) {
      const t = setTimeout(() => {
        if (!this.isConnected) return;
        this.emitText(msg.from, msg.text);
      }, msg.delay);
      this.timers.push(t);
    }

    for (const member of MOCK_CREW) {
      const interval = setInterval(() => {
        if (!this.isConnected) return;
        member.lat += (Math.random() - 0.5) * 0.0002;
        member.lng += (Math.random() - 0.5) * 0.0002;
        this.emit({
          nodeInfo: {
            num: member.nodeId,
            user: {
              id: `!${member.nodeId.toString(16)}`,
              longName: member.longName,
              shortName: member.shortName,
            },
            position: {
              latitudeI: Math.round(member.lat * 1e7),
              longitudeI: Math.round(member.lng * 1e7),
              time: Math.floor(Date.now() / 1000),
            },
            lastHeard: Math.floor(Date.now() / 1000),
            deviceMetrics: { batteryLevel: member.battery },
          },
        });
      }, 10000 + Math.random() * 15000);
      this.driftIntervals.push(interval);
    }
  }

  async sendText(text: string, _channelIndex = 0): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');
    await this.delay(100);
  }

  disconnect(): void {
    this.isConnected = false;
    this.timers.forEach(clearTimeout);
    this.driftIntervals.forEach(clearInterval);
    this.timers = [];
    this.driftIntervals = [];
    this.statusCallback?.('disconnected');
  }

  private emit(fromRadio: FromRadio) {
    this.packetCallback?.(fromRadio);
  }

  private emitText(from: number, text: string) {
    const encoder = new TextEncoder();
    this.emit({
      packet: {
        from,
        to: 0xffffffff,
        channel: 0,
        decoded: {
          portnum: PortNum.TEXT_MESSAGE_APP,
          payload: encoder.encode(text),
        },
        rxTime: Math.floor(Date.now() / 1000),
        id: Math.floor(Math.random() * 0xffffffff),
      },
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const mockBleManager = new MockBleManager();
