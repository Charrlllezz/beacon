import type { TagCategory } from './festival';

export type MessageType = 'text' | 'heading' | 'rally' | 'sos' | 'going' | 'ungoing' | 'color' | 'tag' | 'meetup' | 'reply';

export type SendStatus = 'sending' | 'sent' | 'failed';

export interface BaseMessage {
  id: string;
  fromNodeId: number;
  fromName: string;
  timestamp: number; // unix ms
  channelIndex: number;
  // Only populated for self-originated messages — represents the phone→T-Echo
  // BLE write result. 'sent' doesn't confirm LoRa delivery (broadcasts are
  // fire-and-forget), just that the outbound write succeeded.
  sendStatus?: SendStatus;
  // Meshtastic packet id. Same on every phone (the sender picks it), so it's
  // what replies point at. Missing on messages stored before replies existed.
  packetId?: number;
  // Data.reply_id: the packetId of the message this one answers.
  replyTo?: number;
}

export interface TextMessage extends BaseMessage {
  type: 'text';
  text: string;
}

export interface HeadingMessage extends BaseMessage {
  type: 'heading';
  stageId: string;
}

export interface RallyMessage extends BaseMessage {
  type: 'rally';
  lat: number;
  lng: number;
  note?: string;
}

export interface SOSMessage extends BaseMessage {
  type: 'sos';
  lat: number;
  lng: number;
}

export interface GoingMessage extends BaseMessage {
  type: 'going';
  stageId: string;
  artistId: string;
}

// Broadcast when a user deselects an artist they previously marked "going",
// so peers can drop the stale RSVP instead of showing it forever. Handled
// directly by PacketRouter (removeGoingEntry) — never rendered as a chat bubble.
export interface UngoingMessage extends BaseMessage {
  type: 'ungoing';
  stageId: string;
  artistId: string;
}

export interface ColorMessage extends BaseMessage {
  type: 'color';
  color: string;
}

export interface TagMessage extends BaseMessage {
  type: 'tag';
  lat: number;
  lng: number;
  name: string;
  category: TagCategory;
}

export interface MeetupMessage extends BaseMessage {
  type: 'meetup';
  hour: number;
  minute: number;
  location: string;
  lat?: number;
  lng?: number;
  note?: string;
}

// One-tap answers. omw / cant answer a rally or meetup; coming answers an SOS.
export type ReplyKind = 'omw' | 'cant' | 'coming';
export const REPLY_KINDS: readonly ReplyKind[] = ['omw', 'cant', 'coming'];

// MF:Y:<kind>, with replyTo set from the packet's reply_id. Never a chat
// bubble: shown on the card it answers.
export interface ReplyMessage extends BaseMessage {
  type: 'reply';
  kind: ReplyKind;
}

export type Message = TextMessage | HeadingMessage | RallyMessage | SOSMessage | GoingMessage | UngoingMessage | ColorMessage | TagMessage | MeetupMessage | ReplyMessage;
