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
  // TEMP DIAG (remove once structured-message render bug confirmed fixed):
  // pairs with the PacketRouter log — if 'rx parsed as rally' shows but
  // '[RNDVU-DIAG] render rally' does NOT, the message is added but not rendered
  // (a list/render issue); if both show but it's blank, it's rendering invisibly.
  if (item.type !== 'text') console.warn('[RNDVU-DIAG] render', item.type, item.id);
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
    case 'ungoing': return null; // handled in PacketRouter; never rendered
    default: return <MessageBubble message={item} isMine={isMine} />;
  }
});

export default MessageItem;
