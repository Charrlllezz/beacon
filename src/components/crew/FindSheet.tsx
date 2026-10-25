import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { useCrewStore } from '../../store/useCrewStore';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { CLOSE_RANGE_M, arrowAngle, bearingDegrees, compassPoint, nextRotation, usableHeading } from '../../utils/bearing';
import { pinAge } from '../../utils/pinAge';
import { hapticSuccess } from '../../utils/haptics';

interface Props {
  nodeId: number | null;
  onClose: () => void;
  onShowOnMap: (nodeId: number) => void;
}

const ARROW_SIZE = 220;

/**
 * Full-screen arrow to one crew member: which way to walk, how far, and how
 * old their position is. It only knows their last broadcast position, so it
 * says so when that's stale.
 */
export default function FindSheet({ nodeId, onClose, onShowOnMap }: Props) {
  // Keep showing the last person while the sheet slides closed.
  const shownId = useRef<number | null>(null);
  if (nodeId != null) shownId.current = nodeId;
  const member = useCrewStore(s => (shownId.current != null ? s.crewMembers[shownId.current] : undefined));
  const myLocation = useCrewStore(s => s.myLocation);
  const [heading, setHeading] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const rotation = useRef(new Animated.Value(0)).current;
  const rotationTotal = useRef(0);
  const wasClose = useRef(false);
  const visible = nodeId != null;

  // Compass only while the sheet is open; it costs battery.
  useEffect(() => {
    if (!visible) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchHeadingAsync(h => setHeading(usableHeading(h)))
      .then(s => { if (cancelled) s.remove(); else sub = s; })
      .catch(() => setHeading(null));
    // Re-render so "4m ago" keeps counting while they stand still.
    const timer = setInterval(() => setTick(t => t + 1), 15_000);
    return () => {
      cancelled = true;
      sub?.remove();
      clearInterval(timer);
      setHeading(null);
      wasClose.current = false;
    };
  }, [visible]);

  const hasFix = !!myLocation && member?.lat != null && member?.lng != null;
  const distance = hasFix ? haversineDistance(myLocation!.lat, myLocation!.lng, member!.lat!, member!.lng!) : null;
  const bearing = hasFix ? bearingDegrees(myLocation!.lat, myLocation!.lng, member!.lat!, member!.lng!) : null;
  const close = distance != null && distance < CLOSE_RANGE_M;
  const age = pinAge(member?.locationAt);
  // No compass: point north-up so the arrow at least matches the compass label.
  const target = bearing == null ? null : arrowAngle(bearing, heading ?? 0);

  useEffect(() => {
    if (target == null) return;
    rotationTotal.current = nextRotation(rotationTotal.current, target);
    Animated.timing(rotation, {
      toValue: rotationTotal.current,
      duration: 150,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [target, rotation]);

  useEffect(() => {
    if (close && !wasClose.current) hapticSuccess();
    wasClose.current = close;
  }, [close]);

  const spin = rotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
  const color = member?.color ?? Colors.primary;

  let status: string;
  if (!member) status = '';
  else if (member.lat == null || member.lng == null) status = `No position from ${member.longName} yet. Their radio sends one once it has a GPS fix, which can take a few minutes outside.`;
  else if (!myLocation) status = 'Waiting for your GPS…';
  else if (close) status = `Within about ${CLOSE_RANGE_M} m. GPS can't get closer than this, so look around.`;
  else if (age.stale) status = `This is where they were ${age.label} ago. They've probably moved since.`;
  else if (heading == null) status = `Compass unavailable. Head ${compassPoint(bearing!)}: the arrow shows north as up.`;
  else status = 'Hold your phone flat and walk where the arrow points.';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>Find {member?.longName ?? ''}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <View style={styles.dial}>
            {hasFix && !close && (
              <Animated.View style={[styles.arrowWrap, { opacity: age.stale ? 0.35 : 1, transform: [{ rotate: spin }] }]}>
                <View style={[styles.arrowHead, { borderBottomColor: color }]} />
                <View style={[styles.arrowShaft, { backgroundColor: color }]} />
              </Animated.View>
            )}
            {close && <View style={[styles.closeDot, { backgroundColor: color }]} />}
          </View>

          {distance != null && (
            <Text style={styles.distance}>{close ? 'Close' : formatDistance(distance)}</Text>
          )}
          {member?.lat != null && (
            <Text style={[styles.age, age.stale && styles.ageStale]}>
              {age.label === 'now' ? 'Position from just now' : `Position from ${age.label} ago`}
            </Text>
          )}
          <Text style={styles.status}>{status}</Text>
        </View>

        {member?.lat != null && (
          <TouchableOpacity style={styles.mapButton} onPress={() => nodeId != null && onShowOnMap(nodeId)}>
            <Text style={styles.mapButtonText}>Show on map</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary, flex: 1, marginRight: Spacing.sm },
  close: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.sm },
  dial: {
    width: ARROW_SIZE + Spacing.xl, height: ARROW_SIZE + Spacing.xl, borderRadius: BorderRadius.full,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg,
  },
  arrowWrap: { width: ARROW_SIZE, height: ARROW_SIZE, alignItems: 'center', justifyContent: 'center' },
  arrowHead: {
    width: 0, height: 0,
    borderLeftWidth: 44, borderRightWidth: 44, borderBottomWidth: 80,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  arrowShaft: { width: 26, height: 84, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 },
  closeDot: { width: 56, height: 56, borderRadius: BorderRadius.full },
  distance: { fontSize: 64, fontWeight: '800', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  age: { fontSize: FontSize.md, color: Colors.textSecondary },
  ageStale: { color: Colors.warning },
  status: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, maxWidth: 320 },
  mapButton: {
    margin: Spacing.md, borderWidth: 1, borderColor: Colors.primary, borderRadius: BorderRadius.full,
    paddingVertical: 14, alignItems: 'center',
  },
  mapButtonText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },
});
