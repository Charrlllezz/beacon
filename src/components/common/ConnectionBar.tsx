import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, TouchableOpacity, ActivityIndicator, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import { Colors, FontSize, Fonts } from '../../config/theme';
import { summarizeCrew, summaryLine, type CrewSummary, type SummaryTone } from '../../utils/crewSummary';
import SosBanner from './SosBanner';

const TONE_COLOR: Record<SummaryTone, string> = {
  good: Colors.success,
  partial: Colors.warning,
  none: Colors.textSecondary,
};

/**
 * The strip at the top of every tab. While the radio is linked it answers
 * "is my crew OK?" ("4 of 6 in range · last heard 2 min ago"); tapping it
 * opens the Crew tab. Otherwise it shows the link problem, and tapping opens
 * the Device sheet. A link problem always wins: crew numbers are stale then.
 */
export default function ConnectionBar() {
  const status = useDeviceStore(s => s.status);
  return (
    <>
      {/* An active SOS (yours or someone's) sits above everything else. */}
      <SosBanner />
      {status === 'connected' ? <CrewStrip /> : <LinkProblemBar status={status} />}
    </>
  );
}

function CrewStrip() {
  const crewMembers = useCrewStore(s => s.crewMembers);
  const navigation = useNavigation();
  const route = useRoute();
  // "last heard 3 min ago" should count up while the screen sits open.
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(t);
  }, []);

  const summary = summarizeCrew(Object.values(crewMembers), now);
  const { text, tone } = summaryLine(summary, now);
  const color = TONE_COLOR[tone];
  const onCrewTab = route.name === 'Crew';
  const { head, rest } = calmLine(summary, now);

  return (
    <TouchableOpacity
      style={styles.calmBar}
      onPress={() => { if (!onCrewTab) (navigation as any).navigate('Crew'); }}
      activeOpacity={onCrewTab ? 1 : 0.7}
      accessibilityRole={onCrewTab ? 'text' : 'button'}
      accessibilityLabel={`Crew status: ${text}`}
    >
      <View style={[styles.glowDot, { backgroundColor: color, shadowColor: color }]} />
      <Text style={styles.calmText} numberOfLines={1}>
        <Text style={[styles.calmHead, { color }]}>{head}</Text>
        {rest ? <Text>{`  ·  ${rest}`}</Text> : null}
      </Text>
    </TouchableOpacity>
  );
}

// The strip's short form: how many are in range, then only what needs
// attention (a quiet crew, a low battery). "Last heard just now" is noise.
function calmLine(s: CrewSummary, nowSecs: number): { head: string; rest: string } {
  if (s.total === 0) return { head: 'No crew heard yet', rest: '' };
  const rest: string[] = [];
  const quietFor = s.lastHeardSecs === null ? null : nowSecs - s.lastHeardSecs;
  if (quietFor !== null && quietFor > 120) rest.push(`heard ${Math.round(quietFor / 60)} min ago`);
  if (s.lowBattery.length === 1) rest.push(`${s.lowBattery[0]}'s battery low`);
  else if (s.lowBattery.length > 1) rest.push(`${s.lowBattery.length} batteries low`);
  return { head: `${s.inRange} of ${s.total} in range`, rest: rest.join('  ·  ') };
}

function LinkProblemBar({ status }: { status: string }) {
  const openDeviceSheet = () => useDeviceStore.getState().setDeviceSheetOpen(true);
  const isActive = status === 'scanning' || status === 'connecting' || status === 'reconnecting';

  const config: Record<string, { label: string; color: string }> = {
    disconnected: { label: 'DISCONNECTED', color: Colors.error },
    scanning:     { label: 'SCANNING FOR DEVICE…', color: Colors.warning },
    connecting:   { label: 'CONNECTING…', color: Colors.warning },
    reconnecting: { label: 'RECONNECTING…', color: Colors.warning },
  };

  const { label, color } = config[status] ?? config.disconnected;

  // The whole bar opens the Device/Connection sheet, where the big Reconnect
  // button and the troubleshooting actions live. Tapping the problem indicator
  // is the most natural way into the fix.
  return (
    <TouchableOpacity
      style={[
        styles.bar,
        {
          backgroundColor: color + (status === 'disconnected' ? '44' : '22'),
          borderBottomColor: color + (status === 'disconnected' ? '88' : '44'),
        },
      ]}
      onPress={openDeviceSheet}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Open device and connection troubleshooting"
    >
      {isActive && (
        <ActivityIndicator size="small" color={color} style={styles.spinner} />
      )}
      <Text style={[styles.text, { color }]}>
        {label}
        {status === 'disconnected' && ' — Tap to fix'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  spinner: {
    marginRight: 2,
  },
  text: {
    fontFamily: Fonts.rounded,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  calmBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  glowDot: {
    width: 7, height: 7, borderRadius: 4,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 4,
  },
  calmText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' },
  calmHead: { fontFamily: Fonts.rounded, fontWeight: '700' },
});
