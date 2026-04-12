import type { GpsPoint } from './festival';

export type MessageType = 'text' | 'heading' | 'rally' | 'sos' | 'going' | 'calibration' | 'color' | 'tag' | 'meetup';

export interface BaseMessage {
  id: string;
  fromNodeId: number;
  fromName: string;
  timestamp: number; // unix ms
  channelIndex: number;
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

export interface CalibrationMessage extends BaseMessage {
  type: 'calibration';
  anchors: { topLeft: GpsPoint; bottomRight: GpsPoint };
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

export type Message = TextMessage | HeadingMessage | RallyMessage | SOSMessage | GoingMessage | CalibrationMessage | ColorMessage | TagMessage | MeetupMessage;
