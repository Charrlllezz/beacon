import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { useCrewStore } from '../../store/useCrewStore';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { CLOSE_RANGE_M, arrowAngle, bearingDegrees, compassPoint, nextRotation, usableHeading } from '../../utils/bearing';
import { pinAge } from '../../utils/pinAge';
import { hapticSuccess } from '../../utils/haptics';
import { useDeviceStore } from '../../store/useDeviceStore';
import { capabilities, startPreciseFind, type RangeState } from '../../../modules/rndvu-nearby';
import { formatPrecise, isFresh, trend, uwbArrowDegrees, type Trend, type UwbReading } from '../../utils/preciseFind';
import { useFindStore } from '../../store/useFindStore';
import { askToFind, cancelFind } from '../../services/find/FindController';

interface Props {
  nodeId: number | null;
  onClose: () => void;
  onShowOnMap: (nodeId: number) => void;
}

const ARROW_SIZE = 220;
// Under this, UWB says "right here" instead of pointing.
const HERE_M = 1.5;
// Suggest precise finding once GPS puts them roughly within UWB range.
const SUGGEST_PRECISE_M = 80;

/**
 * Full-screen arrow to one crew member: which way to walk, how far, and how
 * old their position is. Far away it runs on their last GPS position over
 * the mesh and says so when that's stale. Up close, when both phones have
 * Find open on each other and support Ultra Wideband, it switches to UWB:
 * exact distance and a live direction, like Find My's "Find Nearby".
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
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  // Find me: my request to this person, if any.
  const outgoing = useFindStore(s => s.outgoing);
  const asking = outgoing && outgoing.target === shownId.current ? outgoing : null;
  const searching = !!asking;

  // Closing Find ends the search and tells them to stop sharing.
  useEffect(() => {
    if (!visible) return;
    return () => { cancelFind(); };
  }, [visible]);

  const handleAsk = async () => {
    const target = shownId.current;
    if (target == null) return;
    if (!(await askToFind(target))) {
      Alert.alert('Not connected', "Your radio isn't connected right now, so the request can't go out. Try again in a moment.");
    }
  };

  // Ultra Wideband, when both phones can do it.
  const [uwb, setUwb] = useState<UwbReading | null>(null);
  const [uwbState, setUwbState] = useState<RangeState | null>(null);
  const [converged, setConverged] = useState<boolean | null>(null);
  const [uwbTrend, setUwbTrend] = useState<Trend>('steady');
  const trendBase = useRef<{ d: number; at: number } | null>(null);
  const canPrecise = useRef(capabilities()?.distance ?? false).current;

  useEffect(() => {
    const peer = shownId.current;
    if (!visible || !canPrecise || !myNodeNum || peer == null) return;
    const name = useCrewStore.getState().crewMembers[peer]?.longName ?? 'your crew';
    const stop = startPreciseFind(myNodeNum, peer, e => {
      setUwbState(e.state);
      if (e.converged !== undefined) setConverged(e.converged);
      if (e.distance === undefined) return;
      const now = Date.now();
      setUwb({ distance: e.distance, azimuth: e.azimuth, at: now });
      // Warmer/colder against where they were ~2 s ago, not the last
      // reading, so jitter doesn't flip it back and forth.
      const base = trendBase.current;
      if (!base) trendBase.current = { d: e.distance, at: now };
      else if (now - base.at >= 2000) {
        setUwbTrend(trend(base.d, e.distance));
        trendBase.current = { d: e.distance, at: now };
      }
    // Lock-screen distance only during a real search (after Ask), not every
    // time someone glances at the arrow.
    }, searching ? { title: `Finding ${name}`, role: 'finder' } : undefined);
    return () => {
      stop?.();
      setUwb(null);
      setUwbState(null);
      setConverged(null);
      setUwbTrend('steady');
      trendBase.current = null;
    };
  }, [visible, nodeId, myNodeNum, canPrecise, searching]);

  // Compass only while the sheet is open; it costs battery.
  useEffect(() => {
    if (!visible) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchHeadingAsync(h => setHeading(usableHeading(h)))
      .then(s => { if (cancelled) s.remove(); else sub = s; })
      .catch(() => setHeading(null));
    // Re-render so "4m ago" keeps counting, and so a UWB reading that's gone
    // quiet drops back to GPS within a few seconds.
    const timer = setInterval(() => setTick(t => t + 1), 1_000);
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
  const age = pinAge(member?.locationAt);
  // Standing where they were 40 minutes ago isn't "close".
  const close = distance != null && distance < CLOSE_RANGE_M && !age.stale;
  // UWB wins while it's fresh: it's exact and already relative to the phone.
  const precise = isFresh(uwb, Date.now());
  const preciseAngle = precise ? uwbArrowDegrees(uwb!) : null;
  const preciseHere = precise && uwb!.distance! < HERE_M;
  // No compass: point north-up so the arrow at least matches the compass label.
  const gpsTarget = bearing == null ? null : arrowAngle(bearing, heading ?? 0);
  const target = precise ? preciseAngle : gpsTarget;
  const showArrow = precise ? preciseAngle != null && !preciseHere : hasFix && !close;
  const showDot = precise ? !showArrow : close;
  const arrived = precise ? preciseHere : close;

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
    if (arrived && !wasClose.current) hapticSuccess();
    wasClose.current = arrived;
  }, [arrived]);

  const spin = rotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
  const color = member?.color ?? Colors.primary;

  let status: string;
  if (!member) status = '';
  else if (precise && preciseHere) status = `Right here. Look around for ${member.longName}.`;
  else if (precise && preciseAngle != null) status = 'Precise. Hold your phone up in front of you and walk where the arrow points.';
  else if (precise && converged === false) status = 'Move your phone slowly side to side to find the direction.';
  else if (precise) status = uwbTrend === 'warmer' ? 'Getting closer. Keep going.'
    : uwbTrend === 'colder' ? 'Getting further. Turn around.'
    : 'Exact distance, but people are blocking the direction. Walk and watch the number.';
  else if (member.lat == null || member.lng == null) status = `No position from ${member.longName} yet. Their radio sends one once it has a GPS fix, which can take a few minutes outside.`;
  else if (!myLocation) status = 'Waiting for your GPS…';
  else if (age.stale) status = age.label === '?'
    ? "This position is old. They've probably moved since."
    : `This is where they were ${age.label} ago. They've probably moved since.`;
  else if (close) status = `Within about ${CLOSE_RANGE_M} m. GPS can't get closer than this, so look around.`;
  else if (heading == null) status = `Compass unavailable. Head ${compassPoint(bearing!)}: the arrow shows north as up.`;
  else status = 'Hold your phone flat and walk where the arrow points.';

  // Close on GPS but no UWB link yet.
  const suggestPrecise = canPrecise && !precise && distance != null && distance < SUGGEST_PRECISE_M && !age.stale;

  let askStatus: string | null = null;
  if (asking && member) {
    if (asking.helping === true) askStatus = `${member.longName} is helping: their exact spot every 15 seconds.`;
    else if (asking.helping === false) askStatus = `${member.longName} stopped sharing.`;
    else askStatus = `Asked ${member.longName}. Their phone is buzzing, and their radio is sending its position.`;
  }

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
            {showArrow && (
              <Animated.View style={[styles.arrowWrap, { opacity: !precise && age.stale ? 0.35 : 1, transform: [{ rotate: spin }] }]}>
                <View style={[styles.arrowHead, { borderBottomColor: color }]} />
                <View style={[styles.arrowShaft, { backgroundColor: color }]} />
              </Animated.View>
            )}
            {showDot && <View style={[styles.closeDot, { backgroundColor: color }]} />}
          </View>

          {precise ? (
            <Text style={styles.distance}>{formatPrecise(uwb!.distance!)}</Text>
          ) : distance != null && (
            <Text style={styles.distance}>{close ? 'Close' : formatDistance(distance)}</Text>
          )}
          {precise ? (
            <Text style={styles.precise}>Precise · Ultra Wideband</Text>
          ) : member?.lat != null && (
            <Text style={[styles.age, age.stale && styles.ageStale]}>
              {age.label === 'now' ? 'Position from just now' : age.label === '?' ? 'Position time unknown' : `Position from ${age.label} ago`}
            </Text>
          )}
          <Text style={styles.status}>{status}</Text>
          {suggestPrecise && (
            <Text style={styles.hint}>
              {uwbState === 'lost' ? 'Lost the precise signal. Keep walking toward them.'
                : asking?.helping ? 'Getting close: your phones lock on for an exact arrow within about 10 m.'
                : `For an exact arrow, ask ${member!.longName} to help.`}
            </Text>
          )}
        </View>

        {member && !member.isSelf && (
          asking ? (
            <View style={styles.askRow}>
              <Text style={[styles.askStatus, asking.helping === true && styles.askHelping]}>{askStatus}</Text>
              <TouchableOpacity onPress={() => cancelFind()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.askStop}>Stop</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={[styles.askButton, { backgroundColor: color }]} onPress={handleAsk}>
              <Text style={styles.askButtonText}>Ask {member.longName} to help</Text>
            </TouchableOpacity>
          )
        )}

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
  precise: { fontSize: FontSize.md, color: Colors.success, fontWeight: '700' },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center', maxWidth: 300 },
  status: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, maxWidth: 320 },
  askButton: { marginHorizontal: Spacing.md, borderRadius: BorderRadius.full, paddingVertical: 16, alignItems: 'center' },
  askButtonText: { color: '#ffffff', fontSize: FontSize.md, fontWeight: '800' },
  askRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.md, gap: Spacing.md },
  askStatus: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm },
  askHelping: { color: Colors.success, fontWeight: '700' },
  askStop: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },
  mapButton: {
    margin: Spacing.md, borderWidth: 1, borderColor: Colors.primary, borderRadius: BorderRadius.full,
    paddingVertical: 14, alignItems: 'center',
  },
  mapButtonText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },
});
