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
    case 'sos':     return <SOSCard     message={item} />;
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
    case 'calibration': return null;
    default: return <MessageBubble message={item} isMine={isMine} />;
  }
});

export default MessageItem;
