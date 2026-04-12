import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Linking, Platform } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { SOSMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { useCrewStore } from '../../store/useCrewStore';
import { festivalConfig } from '../../services/festival/FestivalConfig';

interface Props {
  message: SOSMessage;
}

export default function SOSCard({ message }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const myLocation = useCrewStore(s => s.myLocation);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const distance = myLocation
    ? haversineDistance(myLocation.lat, myLocation.lng, message.lat, message.lng)
    : null;

  const nearestStage = festivalConfig.getNearestStage(message.lat, message.lng);

  const openInMaps = () => {
    const url = Platform.select({
      ios: `maps:?daddr=${message.lat},${message.lng}`,
      default: `geo:${message.lat},${message.lng}?q=${message.lat},${message.lng}`,
    });
    Linking.openURL(url);
  };

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: pulseAnim }] }]}>
      <View style={styles.header}>
        <Text style={styles.emoji}>🆘</Text>
        <View style={styles.headerText}>
          <Text style={styles.title}>NEEDS HELP</Text>
          <Text style={styles.sender}>{message.fromName}</Text>
        </View>
      </View>
      <View style={styles.locationRow}>
        <View style={styles.locationInfo}>
          {nearestStage && (
            <Text style={styles.nearStage}>Near {nearestStage.shortName}</Text>
          )}
          {distance !== null && (
            <Text style={styles.distance}>{formatDistance(distance)} from you</Text>
          )}
        </View>
        <TouchableOpacity style={styles.navigateBtn} onPress={openInMaps}>
          <Text style={styles.navigateText}>Navigate</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.time}>{timeAgo(message.timestamp / 1000)}</Text>
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
  time: { fontSize: FontSize.xs, color: Colors.error + 'aa', alignSelf: 'flex-end' },
});
