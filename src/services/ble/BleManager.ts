// Set USE_MOCK=true for development without hardware
export const USE_MOCK = true;

export { mockBleManager as bleService } from './MockBleManager';
export type { PacketCallback, StatusCallback } from './MockBleManager';
