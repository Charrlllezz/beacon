import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { TextMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';

interface Props {
  message: TextMessage;
  isMine: boolean;
}

export default function MessageBubble({ message, isMine }: Props) {
  return (
    <View style={[styles.row, isMine && styles.rowMine]}>
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!isMine && (
          <Text style={styles.sender}>{message.fromName}</Text>
        )}
        <Text style={styles.text}>{message.text}</Text>
        <Text style={styles.time}>{timeAgo(message.timestamp / 1000)}</Text>
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
  time: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
});
