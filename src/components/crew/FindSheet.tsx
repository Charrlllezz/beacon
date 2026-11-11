import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Alert, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Colors, Spacing, FontSize, BorderRadius, Fonts, Gradients, crewColor } from '../../config/theme';
import GradientButton from '../ui/GradientButton';
import { useCrewStore } from '../../store/useCrewStore';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { CLOSE_RANGE_M, arrowAngle, bearingDegrees, compassPoint, nextRotation, usableHeading } from '../../utils/bearing';
import { pinAge } from '../../utils/pinAge';
import { hapticLight, hapticSuccess } from '../../utils/haptics';
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

// Proximity tick: a light haptic that comes faster as you close in, so you
// can walk with the phone down. Every 2.5 s from 150 m out, every 0.4 s
// under 10 m, linear in between.
const TICK_FAR_M = 150;
const TICK_NEAR_M = 10;
const TICK_SLOW_MS = 2500;
const TICK_FAST_MS = 400;
export function tickInterval(meters: number): number {
  const t = Math.min(1, Math.max(0, (meters - TICK_NEAR_M) / (TICK_FAR_M - TICK_NEAR_M)));
  return Math.round(TICK_FAST_MS + t * (TICK_SLOW_MS - TICK_FAST_MS));
}

/** A number that rolls to each new value over ~450 ms instead of jumping. */
function useRollingNumber(value: number | null): number | null {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (value == null || from.current == null) { from.current = value; setShown(value); return; }
    const start = from.current;
    const began = Date.now();
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - began) / 450);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = start + (value - start) * eased;
      from.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

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
  const rotation = useSharedValue(0);
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

  // Spring, not a timed turn: the arrow settles like a compass needle. The
  // total keeps growing (nextRotation takes the short way), so 359 -> 0 turns
  // 1 degree, not 359.
  useEffect(() => {
    if (target == null) return;
    rotationTotal.current = nextRotation(rotationTotal.current, target);
    rotation.value = withSpring(rotationTotal.current, { damping: 14, stiffness: 140, mass: 0.7 });
  }, [target]);
  const arrowStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  // The distance the tick follows: UWB when fresh, else GPS. None when the
  // position is stale (ticking toward where they were would mislead).
  const tickMeters = precise ? uwb!.distance! : (distance != null && !age.stale ? distance : null);
  const tickRef = useRef<number | null>(null);
  tickRef.current = tickMeters;
  useEffect(() => {
    if (!visible) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = AppState.currentState === 'active';
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!active) return;
      const m = tickRef.current;
      // Nothing to follow yet: look again in a second.
      timer = setTimeout(() => {
        if (tickRef.current != null) hapticLight();
        schedule();
      }, m == null ? 1000 : tickInterval(m));
    };
    const sub = AppState.addEventListener('change', st => { active = st === 'active'; schedule(); });
    schedule();
    return () => { sub.remove(); if (timer) clearTimeout(timer); };
  }, [visible]);

  const rollingGps = useRollingNumber(distance != null && !close ? distance : null);
  const rollingUwb = useRollingNumber(precise ? uwb!.distance! : null);

  useEffect(() => {
    if (arrived && !wasClose.current) hapticSuccess();
    wasClose.current = arrived;
  }, [arrived]);

  const color = member ? crewColor(member.nodeId, member.color) : Colors.primary;

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
          {member && <View style={[styles.headerDot, { backgroundColor: color }]} />}
          <Text style={styles.title} numberOfLines={1}>Find {member?.longName ?? ''}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <View style={styles.dial}>
            {showArrow && (
              <Animated.View style={[styles.arrowWrap, { opacity: !precise && age.stale ? 0.35 : 1 }, arrowStyle]}>
                <SunsetArrow />
              </Animated.View>
            )}
            {showDot && (
              <LinearGradient colors={Gradients.sunset} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.closeDot} />
            )}
          </View>

          {precise ? (
            <Text style={styles.distance}>{formatPrecise(rollingUwb ?? uwb!.distance!)}</Text>
          ) : distance != null && (
            <Text style={styles.distance}>{close ? 'Close' : formatDistance(rollingGps ?? distance)}</Text>
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
            <GradientButton style={styles.askButton} label={`Ask ${member.longName} to help`} icon="hand.wave" onPress={handleAsk} />
          )
        )}

        {member?.lat != null && (
          <GradientButton style={styles.mapButton} variant="ghost" label="Show on map" icon="map" onPress={() => { if (nodeId != null) onShowOnMap(nodeId); }} />
        )}
      </SafeAreaView>
    </Modal>
  );
}

// The arrow, filled tail to tip with the sunset (orange into pink). The head
// is the top half of a diamond (a rotated square, stretched), clipped: a
// gradient can fill that, which a border triangle can't.
const HEAD_W = 88;
const HEAD_H = 80;
const SQUARE = HEAD_W / Math.SQRT2;
function SunsetArrow() {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: HEAD_W, height: HEAD_H, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, top: HEAD_H - HEAD_W / 2, width: HEAD_W, height: HEAD_W, transform: [{ scaleY: HEAD_H / (HEAD_W / 2) }] }}>
          <LinearGradient
            colors={[Gradients.sunset[1], Gradients.sunset[2]]}
            start={{ x: 1, y: 1 }}
            end={{ x: 0, y: 0 }}
            style={{ position: 'absolute', left: (HEAD_W - SQUARE) / 2, top: (HEAD_W - SQUARE) / 2, width: SQUARE, height: SQUARE, transform: [{ rotate: '45deg' }] }}
          />
        </View>
      </View>
      <LinearGradient
        colors={[Gradients.sunset[0], Gradients.sunset[1]]}
        start={{ x: 0.5, y: 1 }}
        end={{ x: 0.5, y: 0 }}
        style={{ width: 26, height: 84, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border,
  },
  headerDot: { width: 10, height: 10, borderRadius: 5 },
  title: { fontFamily: Fonts.rounded, fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary, flex: 1, marginRight: Spacing.sm },
  close: { fontFamily: Fonts.rounded, fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.sm },
  dial: {
    width: ARROW_SIZE + Spacing.xl, height: ARROW_SIZE + Spacing.xl, borderRadius: BorderRadius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.glassBorder, backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 40,
  },
  arrowWrap: { width: ARROW_SIZE, height: ARROW_SIZE, alignItems: 'center', justifyContent: 'center' },
  closeDot: { width: 56, height: 56, borderRadius: BorderRadius.full },
  distance: { fontFamily: Fonts.rounded, fontSize: 68, fontWeight: '800', color: Colors.textPrimary, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  age: { fontSize: FontSize.md, color: Colors.textSecondary },
  ageStale: { color: Colors.warning },
  precise: { fontFamily: Fonts.rounded, fontSize: FontSize.md, color: Colors.success, fontWeight: '700' },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center', maxWidth: 300 },
  status: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, maxWidth: 320, lineHeight: 19 },
  askButton: { marginHorizontal: Spacing.md },
  askRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.md, gap: Spacing.md },
  askStatus: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm },
  askHelping: { color: Colors.success, fontWeight: '700' },
  askStop: { fontFamily: Fonts.rounded, color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },
  mapButton: { margin: Spacing.md },
});
