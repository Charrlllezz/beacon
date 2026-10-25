import React, { memo } from 'react';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import MessageBubble from './MessageBubble';
import HeadingCard from './HeadingCard';
import RallyCard from './RallyCard';
import SOSCard from './SOSCard';
import MeetupCard from './MeetupCard';
import type { Message } from '../../types/messages';

interface Props {
  item: Message;
  myNodeNum: number | null;
}

const MessageItem = memo(({ item, myNodeNum }: Props) => {
  const isMine = item.fromNodeId === myNodeNum;
  switch (item.type) {
    case 'heading': return <HeadingCard message={item} isMine={isMine} />;
    case 'rally':   return <RallyCard   message={item} isMine={isMine} />;
    // One card per SOS: repeats update it (SOSCard renders only the thread head).
    case 'sos':     return <SOSCard message={item} isMine={isMine} />;
    case 'meetup':  return <MeetupCard  message={item} isMine={isMine} />;
    case 'going': {
      const stage = festivalConfig.getStage(item.stageId);
      const slot = stage?.schedule.find(s => s.artistId === item.artistId);
      const label = slot && stage
        ? `Going to ${slot.artistName} · ${stage.shortName}`
        : `Going to ${item.artistId}`;
      return <MessageBubble message={{ ...item, type: 'text', text: label }} isMine={isMine} />;
    }
    case 'tag': {
      const label = `📌 Tagged: ${item.name} (${item.lat.toFixed(4)}, ${item.lng.toFixed(4)})`;
      return <MessageBubble message={{ ...item, type: 'text', text: label }} isMine={isMine} />;
    }
    case 'color': return null;
    case 'ungoing': return null; // handled in PacketRouter; never rendered
    case 'reply': return null;   // shown on the card it answers
    case 'find':
    case 'findAnswer':
    case 'livePos': return null; // Find me: handled in PacketRouter, never chat
    default: return <MessageBubble message={item} isMine={isMine} />;
  }
});

export default MessageItem;
