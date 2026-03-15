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
  rxTime?: number;
  rxSnr?: number;
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
  config?: unknown;
  logRecord?: unknown;
  configCompleteId?: number;
  rebooted?: boolean;
}

export interface MyNodeInfo {
  myNodeNum: number;
  hasGps?: boolean;
  numBands?: number;
  firmwareVersion?: string;
  errorCode?: number;
  errorAddress?: number;
  errorCount?: number;
  rebootCount?: number;
  bitrate?: number;
  messageTimeoutMsec?: number;
  minAppVersion?: number;
}

export interface ToRadio {
  packet?: MeshPacket;
  wantConfigId?: number;
}
