import type { TagCategory } from './festival';

export type MessageType = 'text' | 'heading' | 'rally' | 'sos' | 'going' | 'ungoing' | 'color' | 'tag' | 'meetup' | 'reply' | 'find' | 'findAnswer' | 'livePos';

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

// The first SOS starts a thread. While it's active the sender's phone repeats
// it with a fresh location every 2 minutes, each repeat an SOS whose replyTo
// is the first one's packetId, until the sender sends a 'safe' reply.
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

// One-tap answers. omw / cant answer a rally or meetup; coming answers an SOS;
// safe is the SOS sender cancelling their own SOS.
export type ReplyKind = 'omw' | 'cant' | 'coming' | 'safe';
export const REPLY_KINDS: readonly ReplyKind[] = ['omw', 'cant', 'coming', 'safe'];

// MF:Y:<kind>, with replyTo set from the packet's reply_id. Never a chat
// bubble: shown on the card it answers.
export interface ReplyMessage extends BaseMessage {
  type: 'reply';
  kind: ReplyKind;
}

// Find me. None of these are chat bubbles; PacketRouter handles them.
// MF:F:<target hex>: "I'm looking for <target>". Only the target acts on it.
// MF:F:<target hex>:0: the finder gave up or found them; stop helping.
export interface FindMessage extends BaseMessage {
  type: 'find';
  target: number;
  cancel: boolean;
}

// MF:A:<finder hex>:<1|0>: the target is helping (1) or has stopped (0).
export interface FindAnswerMessage extends BaseMessage {
  type: 'findAnswer';
  finder: number;
  helping: boolean;
}

// MF:P:<lat>,<lng>: a fresh phone-GPS position, sent every 10 s while helping.
export interface LivePosMessage extends BaseMessage {
  type: 'livePos';
  lat: number;
  lng: number;
}

export type Message = TextMessage | HeadingMessage | RallyMessage | SOSMessage | GoingMessage | UngoingMessage | ColorMessage | TagMessage | MeetupMessage | ReplyMessage | FindMessage | FindAnswerMessage | LivePosMessage;
