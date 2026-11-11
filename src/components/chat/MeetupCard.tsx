import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius, Fonts } from '../../config/theme';
import type { MeetupMessage } from '../../types/messages';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { timeAgo } from '../../utils/time';
import { getMeetupDate } from '../../utils/meetupTime';
import { glassCard } from '../ui/Glass';
import CardIcon from './CardIcon';
import ReplyBar from './ReplyBar';
import { useSenderColor } from './useSenderColor';

interface Props {
  message: MeetupMessage;
  isMine: boolean;
}

export function getLocationLabel(location: string): string {
  const stage = festivalConfig.getStage(location);
  if (stage) return stage.name;
  // Capitalize first letter for custom locations
  if (location && location !== 'Dropped Pin') return location;
  return location;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `in ${hours}h ${remainMin}m` : `in ${hours}h`;
}

export default function MeetupCard({ message, isMine }: Props) {
  const [now, setNow] = useState(Date.now());
  const senderColor = useSenderColor(message.fromNodeId);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const meetupDate = getMeetupDate(message.hour, message.minute, message.timestamp);
  const msUntil = meetupDate.getTime() - now;
  const countdown = formatCountdown(msUntil);
  const locationLabel = getLocationLabel(message.location);
  const ampm = message.hour >= 12 ? 'PM' : 'AM';
  let hour12 = message.hour % 12;
  if (hour12 === 0) hour12 = 12;
  const timeStr = `${hour12}:${message.minute.toString().padStart(2, '0')} ${ampm}`;
  const isPast = msUntil <= 0;

  return (
    <View style={[styles.row, isMine && styles.rowMine]}>
      <View style={[styles.card, isPast && styles.cardPast]}>
        {!isMine && <Text style={[styles.sender, { color: senderColor }]}>{message.fromName}</Text>}
        <View style={styles.header}>
          <CardIcon name="clock.fill" sunset={!isPast} color={Colors.success} />
          <View style={styles.headerText}>
            <Text style={styles.action}>Meetup</Text>
            <Text style={styles.location} numberOfLines={2}>{locationLabel}</Text>
          </View>
          <View style={[styles.timeBadge, isPast && styles.timeBadgePast]}>
            <Text style={[styles.timeText, isPast && styles.timeTextPast]}>{timeStr}</Text>
          </View>
        </View>
        <View style={styles.countdownRow}>
          <Text style={[styles.countdown, isPast && styles.countdownPast]}>
            {isPast ? 'Happening now!' : countdown}
          </Text>
        </View>
        {message.lat != null && message.lng != null && (
          <Text style={styles.coords}>{message.lat.toFixed(4)}, {message.lng.toFixed(4)}</Text>
        )}
        {message.note && (
          <Text style={styles.note}>{message.note}</Text>
        )}
        <ReplyBar message={message} isMine={isMine} options={isPast ? [] : ['omw', 'cant']} />
        <Text style={styles.timestamp}>{timeAgo(message.timestamp / 1000)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginVertical: 4, alignItems: 'flex-start' },
  rowMine: { alignItems: 'flex-end' },
  // A set width, not only maxWidth: sized from its content, the header row
  // squeezed the title, and a two-word stage name ("Sahara Tent") ran on
  // under the time badge, leaving a stray mark after "Sahara".
  card: {
    ...glassCard,
    width: '84%',
    padding: 14,
  },
  cardPast: {
    borderColor: Colors.success + '55',
  },
  sender: {
    fontFamily: Fonts.rounded,
    fontSize: FontSize.xs,
    fontWeight: '700',
    marginBottom: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, minWidth: 0 },
  action: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  location: { fontFamily: Fonts.rounded, fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary, marginTop: 1 },
  timeBadge: {
    backgroundColor: Colors.primary + '22',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
  },
  timeBadgePast: { backgroundColor: Colors.success + '22' },
  timeText: { fontFamily: Fonts.rounded, color: Colors.primary, fontSize: FontSize.sm, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timeTextPast: { color: Colors.success },
  countdownRow: {
    marginTop: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: BorderRadius.sm,
    paddingVertical: 7,
    alignItems: 'center',
  },
  countdown: { fontFamily: Fonts.rounded, color: Colors.primary, fontSize: FontSize.md, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countdownPast: { color: Colors.success },
  coords: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    fontVariant: ['tabular-nums'],
    marginTop: 6,
  },
  note: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 10,
  },
  timestamp: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.sm, alignSelf: 'flex-end' },
});
