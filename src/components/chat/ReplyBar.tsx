import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { Message, ReplyKind } from '../../types/messages';
import { useMessagesStore } from '../../store/useMessagesStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { respondersTo, myAnswer, responderSummary } from '../../utils/replies';
import { buildReplyMessage } from '../../services/mesh/MessageService';
import { sendCrewMessage } from '../../services/mesh/send';
import { hapticLight } from '../../utils/haptics';

const LABELS: Record<ReplyKind, string> = {
  omw: 'On my way',
  cant: "Can't make it",
  coming: "I'm coming",
  safe: "I'm OK",
};

const COLORS: Record<ReplyKind, string> = {
  omw: Colors.success,
  cant: Colors.textSecondary,
  coming: Colors.error,
  safe: Colors.success,
};

interface Props {
  message: Message;
  isMine: boolean;
  // Answers to offer (none: only show who answered).
  options: ReplyKind[];
  // The packet id answers point at, when it isn't this message's own (an
  // SOS card led by a repeat answers the first alert).
  targetPacketId?: number;
}

/**
 * Who has answered a rally point, meetup or SOS, plus one-tap answers for
 * everyone but the sender. Each tap is one small broadcast that points at the
 * card's packet id (Data.reply_id), so it shows up on every phone's card.
 */
export default function ReplyBar({ message, isMine, options, targetPacketId }: Props) {
  const messages = useMessagesStore(s => s.messages);
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  const [sending, setSending] = useState<ReplyKind | null>(null);
  const target = targetPacketId ?? message.packetId;

  const responders = useMemo(() => respondersTo(messages, target), [messages, target]);
  const mine = myAnswer(responders, myNodeNum);
  const summary = responderSummary(responders);
  // Messages from before replies existed have no packet id to answer.
  const canAnswer = !isMine && options.length > 0 && !!target;

  async function answer(kind: ReplyKind) {
    if (sending || kind === mine) return;
    hapticLight();
    setSending(kind);
    const result = await sendCrewMessage(buildReplyMessage(kind), { replyTo: target });
    setSending(null);
    if (!result.ok) {
      Alert.alert('Not sent', result.reason === 'not-ready'
        ? 'Still connecting to your radio. Try again in a moment.'
        : "Couldn't reach your radio. Check the connection and try again.");
    }
  }

  if (!summary && !canAnswer) return null;

  return (
    <View style={styles.wrap}>
      {!!summary && <Text style={styles.summary}>{summary}</Text>}
      {canAnswer && (
        <View style={styles.row}>
          {options.map(kind => {
            const selected = mine === kind;
            const color = COLORS[kind];
            return (
              <TouchableOpacity
                key={kind}
                style={[styles.btn, { borderColor: color + '66' }, selected && { backgroundColor: color + '33', borderColor: color }]}
                onPress={() => answer(kind)}
                disabled={sending !== null}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.btnText, { color: kind === 'cant' ? Colors.textPrimary : color }]}>
                  {sending === kind ? 'Sending…' : selected ? `✓ ${LABELS[kind]}` : LABELS[kind]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.sm, gap: 6 },
  summary: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  // Buttons size to their label (the card is only as wide as its content,
  // and flex: 1 halves of a narrow card cut off "On my way"), and wrap onto
  // a second line before they'd overflow.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  btn: {
    flexGrow: 1,
    flexShrink: 0,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
  },
  btnText: { fontSize: FontSize.xs, fontWeight: '800' },
});
