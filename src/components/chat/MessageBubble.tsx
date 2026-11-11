import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { SFSymbol } from 'expo-symbols';
import { Colors, FontSize, BorderRadius, Gradients, Fonts } from '../../config/theme';
import type { TextMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';
import Icon from '../ui/Icon';
import { glassCard } from '../ui/Glass';
import { useSenderColor } from './useSenderColor';

interface Props {
  message: TextMessage;
  isMine: boolean;
}

function statusIcon(status?: string): { name: SFSymbol; color: string; label: string } | null {
  switch (status) {
    case 'sending': return { name: 'clock', color: 'rgba(255,255,255,0.7)', label: 'Sending' };
    case 'sent':    return { name: 'checkmark', color: 'rgba(255,255,255,0.85)', label: 'Sent' };
    case 'failed':  return { name: 'exclamationmark.circle.fill', color: '#ffe0e0', label: 'Not sent' };
    default:        return null;
  }
}

export default function MessageBubble({ message, isMine }: Props) {
  const status = isMine ? statusIcon(message.sendStatus) : null;
  const senderColor = useSenderColor(message.fromNodeId);
  const footer = (
    <View style={styles.footer}>
      <Text style={[styles.time, isMine && styles.timeMine]}>{timeAgo(message.timestamp / 1000)}</Text>
      {status && (
        <View accessible accessibilityLabel={status.label}>
          <Icon name={status.name} size={11} color={status.color} weight="bold" />
        </View>
      )}
    </View>
  );

  if (isMine) {
    return (
      <View style={[styles.row, styles.rowMine]}>
        <View style={[styles.bubble, styles.bubbleMine]}>
          <LinearGradient
            colors={Gradients.sunset}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={[styles.text, styles.textMine]}>{message.text}</Text>
          {footer}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={[styles.bubble, styles.bubbleTheirs]}>
        <Text style={[styles.sender, { color: senderColor }]}>{message.fromName}</Text>
        <Text style={styles.text}>{message.text}</Text>
        {footer}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  row: {
    marginVertical: 3,
    alignItems: 'flex-start',
  },
  rowMine: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: BorderRadius.lg,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleTheirs: {
    ...glassCard,
    borderBottomLeftRadius: 6,
  },
  bubbleMine: {
    overflow: 'hidden',
    borderBottomRightRadius: 6,
  },
  sender: {
    fontFamily: Fonts.rounded,
    fontSize: FontSize.xs,
    fontWeight: '700',
    marginBottom: 3,
  },
  text: {
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  textMine: {
    color: '#fff',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
    marginTop: 4,
  },
  time: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  timeMine: {
    color: 'rgba(255,255,255,0.75)',
  },
});
