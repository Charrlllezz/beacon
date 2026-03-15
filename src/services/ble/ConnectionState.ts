export type BleConnectionState =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export const MESHTASTIC_SERVICE_UUID = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
export const FROM_RADIO_UUID = '2c55e69e-4993-11ed-b878-0242ac120002';
export const TO_RADIO_UUID = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
export const FROM_NUM_UUID = 'ed9da18c-a800-4f66-a670-aa7547de15e6';
