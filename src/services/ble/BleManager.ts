// Set USE_MOCK=true for development without hardware
export const USE_MOCK = false;

export { realBleManager as bleService } from './RealBleManager';
export type { PacketCallback, StatusCallback } from './RealBleManager';
