import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { MeetupMessage } from '../../types/messages';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { timeAgo } from '../../utils/time';

interface Props {
  message: MeetupMessage;
  isMine: boolean;
}

function getLocationLabel(location: string): string {
  const stage = festivalConfig.getStage(location);
  if (stage) return stage.name;
  // Capitalize first letter for custom locations
  if (location && location !== 'Dropped Pin') return location;
  return location;
}

function getMeetupDate(hour: number, minute: number): Date {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  // If time has passed today, assume tomorrow
  if (target <= now) target.setDate(target.getDate() + 1);
  return target;
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

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const meetupDate = getMeetupDate(message.hour, message.minute);
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
        {!isMine && <Text style={styles.sender}>{message.fromName}</Text>}
        <View style={styles.header}>
          <Text style={styles.emoji}>📍</Text>
          <View style={styles.headerText}>
            <Text style={styles.action}>Meetup</Text>
            <Text style={styles.location}>{locationLabel}</Text>
          </View>
          <View style={styles.timeBadge}>
            <Text style={styles.timeText}>{timeStr}</Text>
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
        <Text style={styles.timestamp}>{timeAgo(message.timestamp / 1000)}</Text>
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
    borderColor: Colors.primary + '44',
  },
  cardPast: {
    borderColor: Colors.success + '44',
    borderLeftColor: Colors.success,
  },
  sender: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emoji: { fontSize: 28 },
  headerText: { flex: 1 },
  action: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  location: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary, marginTop: 1 },
  timeBadge: {
    backgroundColor: Colors.primary + '22',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  timeText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '800', fontFamily: 'monospace' },
  countdownRow: {
    marginTop: 8,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.sm,
    padding: 6,
    alignItems: 'center',
  },
  countdown: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },
  countdownPast: { color: Colors.success },
  coords: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    fontFamily: 'monospace',
    marginTop: 6,
  },
  note: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 8,
  },
  timestamp: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 8, alignSelf: 'flex-end' },
});
