import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { TextMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';

interface Props {
  message: TextMessage;
  isMine: boolean;
}

function statusGlyph(status?: string): { char: string; color: string } | null {
  switch (status) {
    case 'sending': return { char: '○', color: '#ffffff99' };
    case 'sent':    return { char: '✓', color: '#ffffffcc' };
    case 'failed':  return { char: '!', color: '#ff7b7b' };
    default:        return null;
  }
}

export default function MessageBubble({ message, isMine }: Props) {
  const glyph = isMine ? statusGlyph(message.sendStatus) : null;
  return (
    <View style={[styles.row, isMine && styles.rowMine]}>
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!isMine && (
          <Text style={styles.sender}>{message.fromName}</Text>
        )}
        <Text style={styles.text}>{message.text}</Text>
        <View style={styles.footer}>
          <Text style={styles.time}>{timeAgo(message.timestamp / 1000)}</Text>
          {glyph && (
            <Text style={[styles.statusGlyph, { color: glyph.color }]}>{glyph.char}</Text>
          )}
        </View>
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
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  bubbleTheirs: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#1e1d2a',
  },
  bubbleMine: {
    backgroundColor: Colors.primary + 'cc',
    borderBottomRightRadius: 4,
  },
  sender: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 3,
  },
  text: {
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    marginTop: 4,
  },
  time: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  statusGlyph: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
});
