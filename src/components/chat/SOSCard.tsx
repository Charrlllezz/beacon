import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Linking, Platform } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { SOSMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { useCrewStore } from '../../store/useCrewStore';
import { useMessagesStore } from '../../store/useMessagesStore';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { NOT_EMERGENCY_SERVICES } from '../../config/safetyCopy';
import { sosThread, isSosHead, sosAnchor } from '../../utils/sos';
import ReplyBar from './ReplyBar';

interface Props {
  message: SOSMessage;
  isMine: boolean;
}

/**
 * One SOS from first alert to "I'm OK": the latest location from the sender's
 * repeats, who's coming, and an "I'm coming" button for everyone else.
 */
export default function SOSCard({ message, isMine }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const myLocation = useCrewStore(s => s.myLocation);
  const messages = useMessagesStore(s => s.messages);
  const isHead = useMemo(() => isSosHead(messages, message), [messages, message]);
  const thread = useMemo(() => sosThread(messages, message), [messages, message]);

  useEffect(() => {
    if (thread.ended) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [thread.ended]);

  const distance = myLocation
    ? haversineDistance(myLocation.lat, myLocation.lng, thread.lat, thread.lng)
    : null;

  const nearestStage = festivalConfig.getNearestStage(thread.lat, thread.lng);

  const openInMaps = () => {
    const url = Platform.select({
      ios: `maps:?daddr=${thread.lat},${thread.lng}`,
      default: `geo:${thread.lat},${thread.lng}?q=${thread.lat},${thread.lng}`,
    });
    Linking.openURL(url);
  };

  // A repeat of an SOS that already has a card.
  if (!isHead) return null;

  if (thread.ended) {
    return (
      <View style={[styles.card, styles.cardEnded]}>
        <Text style={styles.endedTitle}>✓ {isMine ? 'You' : message.fromName} said {isMine ? "you're" : "they're"} OK</Text>
        <Text style={styles.endedSub}>
          SOS {timeAgo(message.timestamp / 1000)}, cancelled {timeAgo((thread.endedAt ?? 0) / 1000)}
        </Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: pulseAnim }] }]}>
      <View style={styles.header}>
        <Text style={styles.emoji}>🆘</Text>
        <View style={styles.headerText}>
          <Text style={styles.title}>{isMine ? 'YOUR SOS IS ON' : 'NEEDS HELP'}</Text>
          <Text style={styles.sender}>{isMine ? 'Your crew gets your location every 2 min' : message.fromName}</Text>
        </View>
      </View>
      <View style={styles.locationRow}>
        <View style={styles.locationInfo}>
          {nearestStage && (
            <Text style={styles.nearStage}>Near {nearestStage.shortName}</Text>
          )}
          {distance !== null && !isMine && (
            <Text style={styles.distance}>{formatDistance(distance)} from you</Text>
          )}
          <Text style={styles.distance}>
            Location {timeAgo(thread.updatedAt / 1000)}{thread.sends > 1 ? ` · ${thread.sends} updates` : ''}
          </Text>
        </View>
        {!isMine && (
          <TouchableOpacity style={styles.navigateBtn} onPress={openInMaps}>
            <Text style={styles.navigateText}>Navigate</Text>
          </TouchableOpacity>
        )}
      </View>
      <ReplyBar message={message} isMine={isMine} options={['coming']} targetPacketId={sosAnchor(message)} />
      <View style={styles.footer}>
        <Text style={styles.notice}>{NOT_EMERGENCY_SERVICES}</Text>
        <Text style={styles.time}>{timeAgo(message.timestamp / 1000)}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.error + '18',
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.error,
    padding: Spacing.md,
    marginVertical: 6,
  },
  cardEnded: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.success + '55',
  },
  endedTitle: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.success },
  endedSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  emoji: { fontSize: 36 },
  headerText: { flex: 1 },
  title: {
    fontSize: FontSize.lg,
    fontWeight: '900',
    color: Colors.error,
    letterSpacing: 1,
  },
  sender: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    fontWeight: '600',
    marginTop: 2,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: 8,
  },
  locationInfo: { flex: 1 },
  nearStage: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '700' },
  distance: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  navigateBtn: {
    backgroundColor: Colors.error,
    borderRadius: BorderRadius.full,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  navigateText: { color: '#fff', fontSize: FontSize.xs, fontWeight: '800' },
  footer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, marginTop: Spacing.sm },
  notice: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary },
  time: { fontSize: FontSize.xs, color: Colors.error + 'aa', alignSelf: 'flex-end' },
});
