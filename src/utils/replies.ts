import type { Message, ReplyKind, ReplyMessage } from '../types/messages';

export interface Responder {
  nodeId: number;
  name: string;
  kind: ReplyKind;
  at: number; // ms
}

/**
 * Who has answered a message, one entry per person: their latest answer wins,
 * so "On my way" then "Can't make it" shows as can't make it. Oldest first.
 */
export function respondersTo(messages: Message[], packetId: number | undefined): Responder[] {
  if (!packetId) return [];
  const latest = new Map<number, Responder>();
  for (const m of messages) {
    if (m.type !== 'reply' || m.replyTo !== packetId) continue;
    // My answer that never reached the radio isn't an answer: the crew didn't
    // get it, and counting it locked the button on a "✓ On my way" nobody saw.
    if (m.sendStatus === 'failed') continue;
    const prev = latest.get(m.fromNodeId);
    if (prev && prev.at > m.timestamp) continue;
    latest.set(m.fromNodeId, { nodeId: m.fromNodeId, name: m.fromName, kind: (m as ReplyMessage).kind, at: m.timestamp });
  }
  return [...latest.values()].sort((a, b) => a.at - b.at);
}

export function myAnswer(responders: Responder[], myNodeNum: number | null): ReplyKind | null {
  if (myNodeNum === null) return null;
  return responders.find(r => r.nodeId === myNodeNum)?.kind ?? null;
}

/** "Ash, Bo on the way · Cy can't make it" */
export function responderSummary(responders: Responder[]): string {
  const names = (kind: ReplyKind) => responders.filter(r => r.kind === kind).map(r => r.name);
  const parts: string[] = [];
  const omw = names('omw');
  const cant = names('cant');
  const coming = names('coming');
  if (coming.length) parts.push(`${coming.join(', ')} coming`);
  if (omw.length) parts.push(`${omw.join(', ')} on the way`);
  if (cant.length) parts.push(`${cant.join(', ')} can't make it`);
  return parts.join(' · ');
}
