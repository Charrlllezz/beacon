export interface CrewMember {
  nodeId: number;
  longName: string;
  shortName: string;
  batteryLevel?: number;
  lastHeard?: number;      // unix timestamp (seconds)
  lat?: number;
  lng?: number;
  snr?: number;
  color?: string;
  emoji?: string;
  isOnline: boolean;
  isSelf?: boolean;
}
