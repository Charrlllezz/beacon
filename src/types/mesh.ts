export interface Position {
  latitudeI: number;  // degrees * 1e7
  longitudeI: number; // degrees * 1e7
  altitude?: number;
  time?: number;      // unix timestamp
  speed?: number;
  heading?: number;
}

export interface User {
  id: string;
  longName: string;
  shortName: string;
  macaddr?: string;
  hwModel?: number;
  isLicensed?: boolean;
}

export interface NodeInfo {
  num: number;
  user?: User;
  position?: Position;
  snr?: number;
  lastHeard?: number; // unix timestamp
  deviceMetrics?: DeviceMetrics;
}

export interface DeviceMetrics {
  batteryLevel?: number;  // 0-100
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
}

export interface Telemetry {
  time: number;
  deviceMetrics?: DeviceMetrics;
}

export interface MeshPacket {
  from: number;
  to: number;
  channel: number;
  decoded?: DataPayload;
  rxTime?: number;  // unix seconds
  rxSnr?: number;   // float dB
  hopLimit?: number;
  id?: number;
}

export interface DataPayload {
  portnum: PortNum;
  payload: Uint8Array;
  wantResponse?: boolean;
  dest?: number;
  source?: number;
}

export enum PortNum {
  UNKNOWN_APP = 0,
  TEXT_MESSAGE_APP = 1,
  REMOTE_HARDWARE_APP = 2,
  POSITION_APP = 3,
  NODEINFO_APP = 4,
  ROUTING_APP = 5,
  ADMIN_APP = 6,
  TELEMETRY_APP = 67,
  ATAK_FORWARDER = 140,
}

export interface FromRadio {
  num?: number;
  packet?: MeshPacket;
  myInfo?: MyNodeInfo;
  nodeInfo?: NodeInfo;
  config?: DeviceConfig;
  logRecord?: unknown;
  configCompleteId?: number;
  rebooted?: boolean;
  channel?: Channel;
  metadata?: DeviceMetadata;
}

export interface DeviceMetadata {
  firmwareVersion?: string;
  hasBluetooth?: boolean;
  hasWifi?: boolean;
  hasPKC?: boolean;
  hwModel?: number;
}

export interface Channel {
  index: number;
  settings?: ChannelSettings;
  role?: number; // DISABLED=0, PRIMARY=1, SECONDARY=2
  // Short non-reversible hash of the channel PSK. Lets two devices confirm they
  // share the same key at a glance without ever exposing the key itself.
  keyFingerprint?: string;
}

export interface DeviceConfig {
  lora?: {
    region?: number; // RegionCode enum: 0=UNSET, 1=US, 2=EU_433, 3=EU_868, ...
  };
}

export interface ChannelSettings {
  name?: string;
  // psk/id intentionally omitted — we don't need to expose the raw key or
  // globally-unique id in app-side state.
}

export interface MyNodeInfo {
  myNodeNum: number;
  // Meshtastic 2.5.x MyNodeInfo fields we care about. Firmware reports
  // nodedb_count (field 15) so we can wait for exactly that many NodeInfo
  // packets during the config drain instead of guessing a read cap.
  nodedbCount?: number;
  rebootCount?: number;      // field 8
  minAppVersion?: number;    // field 11
  firmwareEdition?: number;  // field 14
}

export interface ToRadio {
  packet?: MeshPacket;
  wantConfigId?: number;
}
