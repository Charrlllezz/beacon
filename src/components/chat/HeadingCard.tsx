import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius, Fonts } from '../../config/theme';
import type { HeadingMessage } from '../../types/messages';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { timeAgo } from '../../utils/time';
import { glassCard } from '../ui/Glass';
import CardIcon from './CardIcon';
import { useSenderColor } from './useSenderColor';

interface Props {
  message: HeadingMessage;
  isMine: boolean;
}

export default function HeadingCard({ message, isMine }: Props) {
  const stage = festivalConfig.getStage(message.stageId);
  const nowPlaying = stage ? festivalConfig.getNowPlaying(message.stageId) : undefined;
  const stageName = stage?.name ?? message.stageId;
  const stageColor = stage?.color ?? Colors.primary;
  const senderColor = useSenderColor(message.fromNodeId);

  return (
    <View style={[styles.row, isMine && styles.rowMine]}>
      <View style={styles.card}>
        {!isMine && <Text style={[styles.sender, { color: senderColor }]}>{message.fromName}</Text>}
        <View style={styles.header}>
          <CardIcon name="figure.walk" color={stageColor} />
          <View style={styles.headerText}>
            <Text style={styles.action}>Heading to</Text>
            <Text style={[styles.stageName, { color: stageColor }]}>{stageName}</Text>
          </View>
        </View>
        {nowPlaying && (
          <View style={styles.nowPlaying}>
            <View style={styles.liveDot} />
            <Text style={styles.nowPlayingText}>{nowPlaying.artistName} is on now</Text>
          </View>
        )}
        <Text style={styles.time}>{timeAgo(message.timestamp / 1000)}</Text>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  row: { marginVertical: 4, alignItems: 'flex-start' },
  rowMine: { alignItems: 'flex-end' },
  card: {
    ...glassCard,
    maxWidth: '84%',
    padding: 14,
  },
  sender: {
    fontFamily: Fonts.rounded,
    fontSize: FontSize.xs,
    fontWeight: '700',
    marginBottom: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1 },
  action: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  stageName: { fontFamily: Fonts.rounded, fontSize: FontSize.lg, fontWeight: '800', marginTop: 1 },
  nowPlaying: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
    backgroundColor: Colors.success + '11',
    borderRadius: BorderRadius.sm,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  nowPlayingText: { fontSize: FontSize.xs, color: Colors.success, fontWeight: '600' },
  time: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 8, alignSelf: 'flex-end' },
});
