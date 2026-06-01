import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Spacing, FontSize, BorderRadius } from '../config/theme';
import { useDeviceStore } from '../store/useDeviceStore';
import { useCrewStore } from '../store/useCrewStore';
import { useMessagesStore } from '../store/useMessagesStore';
import { isOnline } from '../utils/time';
import { USE_MOCK } from '../services/ble/BleManager';
import { mockBleManager } from '../services/ble/MockBleManager';
import {
  SCENARIO_LABELS,
  saveScenario,
  type ScenarioName,
} from '../services/ble/MockScenarios';

interface Props {
  onClose: () => void;
}

/**
 * RNDVU's encoders target Meshtastic 2.5.x proto field layout. 2.6.x should
 * be backward-compatible. Older (2.4 and before) may have proto drift on
 * admin field numbers and we surface a warning so a tester who upgraded
 * firmware to an untested version knows to check behavior.
 */
function isCompatibleFirmware(v: string | null): boolean | null {
  if (!v) return null;
  const m = /^(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major !== 2) return false;
  return minor >= 5 && minor <= 6;
}

/**
 * Diagnostic snapshot of current app + device state. The goal is: when a
 * tester says "something's broken," they open this screen and share the
 * payload — no back-and-forth required to figure out what version they're
 * running, what channel they're on, or whether they're even receiving
 * packets.
 */
export default function DebugScreen({ onClose }: Props) {
  const status = useDeviceStore(s => s.status);
  const connectedDeviceName = useDeviceStore(s => s.connectedDeviceName);
  const connectedDeviceId = useDeviceStore(s => s.connectedDeviceId);
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  const firmwareVersion = useDeviceStore(s => s.firmwareVersion);
  const hwModel = useDeviceStore(s => s.hwModel);
  const hasPKC = useDeviceStore(s => s.hasPKC);
  const channelName = useDeviceStore(s => s.channelName);
  const channelIndex = useDeviceStore(s => s.channelIndex);
  const lastPacketAt = useDeviceStore(s => s.lastPacketAt);
  const crewMembers = useCrewStore(s => s.crewMembers);
  const myLocation = useCrewStore(s => s.myLocation);
  const messages = useMessagesStore(s => s.messages);
  const [now, setNow] = useState(Date.now());
  const [storageKeys, setStorageKeys] = useState<string[]>([]);

  // Tick every second so "last packet X ago" stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    AsyncStorage.getAllKeys().then((keys) => {
      setStorageKeys(keys.filter(k => k.startsWith('rndvu_')));
    }).catch(() => {});
  }, []);

  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const buildNumber = Constants.expoConfig?.ios?.buildNumber ?? 'unknown';
  const totalCrew = Object.values(crewMembers).filter(m => !m.isSelf).length;
  const onlineCrew = Object.values(crewMembers).filter(m => !m.isSelf && isOnline(m.lastHeard)).length;
  const selfEntry = myNodeNum ? crewMembers[myNodeNum] : null;

  const packetAgo = lastPacketAt ? Math.floor((now - lastPacketAt) / 1000) : null;
  const fwCompat = isCompatibleFirmware(firmwareVersion);

  function renderRow(label: string, value: React.ReactNode, ok?: boolean | null) {
    return (
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.valueWrap}>
          {ok !== undefined && ok !== null && (
            <View style={[styles.dot, { backgroundColor: ok ? Colors.success : Colors.error }]} />
          )}
          <Text style={styles.value} numberOfLines={2}>{value}</Text>
        </View>
      </View>
    );
  }

  async function copySummary() {
    const summary = [
      `RNDVU ${appVersion} (build ${buildNumber})`,
      `BLE: ${status} ${connectedDeviceName ?? '-'} (${connectedDeviceId ?? 'no id'})`,
      `myNode: ${myNodeNum ? `0x${myNodeNum.toString(16)}` : '—'}`,
      `firmware: ${firmwareVersion ?? '—'} hw:${hwModel ?? '—'} pkc:${hasPKC ?? '—'}`,
      `channel: "${channelName}" idx=${channelIndex ?? '—'}`,
      `crew: ${onlineCrew}/${totalCrew} online`,
      `msgs: ${messages.length}`,
      `lastPkt: ${packetAgo !== null ? `${packetAgo}s ago` : 'never'}`,
      `gps: ${myLocation ? `${myLocation.lat.toFixed(4)}, ${myLocation.lng.toFixed(4)}` : '—'}`,
      `self: ${selfEntry ? `${selfEntry.longName}/${selfEntry.shortName}` : '—'}`,
      `storageKeys: ${storageKeys.length}`,
    ].join('\n');
    Alert.alert('Debug Info', summary);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>Done</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Debug Info</Text>
        <TouchableOpacity onPress={copySummary} style={styles.copyBtn}>
          <Text style={styles.copyText}>Share</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>APP</Text>
        {renderRow('Version', appVersion)}
        {renderRow('Build', buildNumber)}

        <Text style={styles.section}>BLUETOOTH</Text>
        {renderRow('Status', status, status === 'connected')}
        {renderRow('Device', connectedDeviceName ?? '—')}
        {renderRow('Device ID', connectedDeviceId ?? '—')}
        {renderRow('Last packet', packetAgo !== null ? `${packetAgo}s ago` : 'never', packetAgo !== null && packetAgo < 120)}

        <Text style={styles.section}>T-ECHO</Text>
        {renderRow(
          'Firmware',
          firmwareVersion ? `${firmwareVersion}${fwCompat === false ? ' (untested)' : ''}` : 'unknown (waiting for drain)',
          fwCompat === null ? !!firmwareVersion : fwCompat,
        )}
        {renderRow('HW model', hwModel !== null ? String(hwModel) : '—')}
        {renderRow('PKC', hasPKC === null ? '—' : hasPKC ? 'supported' : 'not supported')}
        {renderRow('My node', myNodeNum ? `0x${myNodeNum.toString(16)} (${myNodeNum})` : 'not ready', !!myNodeNum)}
        {renderRow('Self name', selfEntry ? `${selfEntry.longName} / ${selfEntry.shortName}` : '—')}

        <Text style={styles.section}>CHANNEL</Text>
        {renderRow('Name', channelName, channelName === 'RNDVU')}
        {renderRow('Index', channelIndex !== null ? String(channelIndex) : '—')}

        <Text style={styles.section}>MESH</Text>
        {renderRow('Crew total', String(totalCrew))}
        {renderRow('Crew online', String(onlineCrew))}
        {renderRow('Messages cached', String(messages.length))}

        <Text style={styles.section}>GPS</Text>
        {renderRow('My location', myLocation ? `${myLocation.lat.toFixed(4)}, ${myLocation.lng.toFixed(4)}` : 'waiting for fix', !!myLocation)}

        {USE_MOCK && <MockControls />}

        <Text style={styles.section}>STORAGE</Text>
        {storageKeys.map(key => (
          <Text key={key} style={styles.keyItem}>• {key}</Text>
        ))}

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Mock-only controls. Rendered only when USE_MOCK=true so these imports are
 * tree-shaken out of production builds. Tree-shaking via dead-code elim relies
 * on USE_MOCK being a const; don't let it become a runtime value.
 */
function MockControls() {
  const [active, setActive] = useState<ScenarioName>(mockBleManager.getActiveScenario());

  async function pickScenario(name: ScenarioName) {
    await saveScenario(name);
    setActive(name);
    Alert.alert(
      'Scenario Saved',
      `"${SCENARIO_LABELS[name]}" will apply on next app restart. Close and reopen the app to load it.`,
    );
  }

  const scenarioNames = Object.keys(SCENARIO_LABELS) as ScenarioName[];

  return (
    <>
      <Text style={mockStyles.section}>MOCK CONTROLS</Text>
      <Text style={mockStyles.hint}>Scenario (applies on next launch)</Text>
      {scenarioNames.map(name => (
        <TouchableOpacity
          key={name}
          style={[mockStyles.scenarioRow, active === name && mockStyles.scenarioRowActive]}
          onPress={() => pickScenario(name)}
        >
          <Text style={[mockStyles.scenarioLabel, active === name && mockStyles.scenarioLabelActive]}>
            {active === name ? '● ' : '○ '}{SCENARIO_LABELS[name]}
          </Text>
        </TouchableOpacity>
      ))}
      <Text style={mockStyles.hint}>Live injection (this session)</Text>
      <View style={mockStyles.buttonRow}>
        <TouchableOpacity
          style={mockStyles.actionBtn}
          onPress={() => mockBleManager.simulateDrop(5000)}
        >
          <Text style={mockStyles.actionLabel}>Drop BLE 5s</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={mockStyles.actionBtn}
          onPress={() => mockBleManager.injectTestMessage('test ping from debug')}
        >
          <Text style={mockStyles.actionLabel}>Inject msg</Text>
        </TouchableOpacity>
      </View>
      <View style={mockStyles.buttonRow}>
        <TouchableOpacity
          style={mockStyles.actionBtn}
          onPress={() => mockBleManager.advanceTime(30 * 60)}
        >
          <Text style={mockStyles.actionLabel}>Age peers 30m</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={mockStyles.actionBtn}
          onPress={() => mockBleManager.advanceTime(2 * 3600)}
        >
          <Text style={mockStyles.actionLabel}>Age peers 2h</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const mockStyles = StyleSheet.create({
  section: {
    color: Colors.warning,
    fontSize: FontSize.xs,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
  },
  hint: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    marginTop: Spacing.sm,
    marginBottom: 6,
  },
  scenarioRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginBottom: 4,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scenarioRowActive: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warning + '18',
  },
  scenarioLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
  scenarioLabelActive: {
    color: Colors.warning,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.warning + '55',
  },
  actionLabel: {
    color: Colors.warning,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { color: Colors.textPrimary, fontWeight: '700', fontSize: FontSize.md },
  closeBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  closeText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
  copyBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  copyText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
  content: { padding: Spacing.md },
  section: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '66',
  },
  label: { color: Colors.textSecondary, fontSize: FontSize.sm, flex: 1 },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '60%' },
  value: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '500' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  keyItem: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    fontFamily: 'Courier',
    paddingVertical: 2,
  },
});
