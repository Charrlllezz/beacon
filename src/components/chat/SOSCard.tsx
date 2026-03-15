import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { SOSMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';
import { formatGps } from '../../utils/coordinates';

interface Props {
  message: SOSMessage;
}

export default function SOSCard({ message }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

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
        <Text style={styles.locationLabel}>Location: </Text>
        <Text style={styles.location}>{formatGps(message.lat, message.lng)}</Text>
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
  locationLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '700' },
  location: { fontSize: FontSize.xs, color: Colors.textPrimary, fontFamily: 'monospace' },
  time: { fontSize: FontSize.xs, color: Colors.error + 'aa', alignSelf: 'flex-end' },
});
