import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import { Colors, FontSize } from '../../config/theme';
import { summarizeCrew, summaryLine, type SummaryTone } from '../../utils/crewSummary';

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
  if (status === 'connected') return <CrewStrip />;
  return <LinkProblemBar status={status} />;
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

  const { text, tone } = summaryLine(summarizeCrew(Object.values(crewMembers), now), now);
  const color = TONE_COLOR[tone];
  const onCrewTab = route.name === 'Crew';

  return (
    <TouchableOpacity
      style={[styles.bar, { backgroundColor: color + '14', borderBottomColor: color + '33' }]}
      onPress={() => { if (!onCrewTab) (navigation as any).navigate('Crew'); }}
      activeOpacity={onCrewTab ? 1 : 0.7}
      accessibilityRole={onCrewTab ? 'text' : 'button'}
      accessibilityLabel={`Crew status: ${text}`}
    >
      <Text style={[styles.dot, { color }]}>●</Text>
      <Text style={[styles.text, { color }]} numberOfLines={1}>{text}</Text>
    </TouchableOpacity>
  );
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
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  spinner: {
    marginRight: 2,
  },
  dot: { fontSize: 10 },
  text: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
