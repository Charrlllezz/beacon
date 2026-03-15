import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { RallyMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';
import { formatGps } from '../../utils/coordinates';

interface Props {
  message: RallyMessage;
  isMine: boolean;
}

export default function RallyCard({ message, isMine }: Props) {
  return (
    <View style={[styles.row, isMine && styles.rowMine]}>
      <View style={styles.card}>
        {!isMine && <Text style={styles.sender}>{message.fromName}</Text>}
        <View style={styles.header}>
          <Text style={styles.emoji}>📍</Text>
          <View>
            <Text style={styles.title}>Rally Point</Text>
            {message.note && <Text style={styles.note}>{message.note}</Text>}
          </View>
        </View>
        {/* Mini map placeholder — shows coordinates */}
        <View style={styles.mapPreview}>
          <Text style={styles.mapEmoji}>🗺️</Text>
          <Text style={styles.coords}>{formatGps(message.lat, message.lng)}</Text>
        </View>
        <Text style={styles.time}>{timeAgo(message.timestamp / 1000)}</Text>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  row: { marginVertical: 4, alignItems: 'flex-start' },
  rowMine: { alignItems: 'flex-end' },
  card: {
    maxWidth: '82%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: '#1e1d2a',
  },
  sender: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  emoji: { fontSize: 28 },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  note: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  mapPreview: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  mapEmoji: { fontSize: 22 },
  coords: { fontSize: FontSize.xs, color: Colors.textSecondary, fontFamily: 'monospace' },
  time: { fontSize: FontSize.xs, color: Colors.textMuted, alignSelf: 'flex-end' },
});
