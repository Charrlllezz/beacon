import React, { useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Spacing, FontSize, BorderRadius } from '../config/theme';
import { useDeviceStore } from '../store/useDeviceStore';
import { useCrewStore } from '../store/useCrewStore';
import { bleService } from '../services/ble/BleManager';
import { regionName, RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK } from '../services/ble/MeshtasticCodec';
import { timeAgo } from '../utils/time';

const STATUS_META: Record<string, { label: string; color: string; hint: string }> = {
  connected:    { label: 'Connected',     color: Colors.success, hint: 'Your T-Echo is linked and ready.' },
  reconnecting: { label: 'Reconnecting…', color: Colors.warning, hint: 'Trying to restore the link…' },
  connecting:   { label: 'Connecting…',   color: Colors.warning, hint: 'Linking to your T-Echo…' },
  scanning:     { label: 'Scanning…',     color: Colors.warning, hint: 'Looking for your T-Echo…' },
  disconnected: { label: 'Disconnected',  color: Colors.error,   hint: 'Not linked to a T-Echo. Tap Reconnect, or try the steps below.' },
};

/**
 * Device & Connection sheet. Opened from the tappable ConnectionBar and the
 * header gear (both flip useDeviceStore.deviceSheetOpen). Surfaces the recovery
 * actions that used to be hidden behind a long-press on the Crew header.
 * Rendered once at the app root so it overlays any screen.
 */
export default function DeviceScreen() {
  const open = useDeviceStore(s => s.deviceSheetOpen);
  const status = useDeviceStore(s => s.status);
  const deviceName = useDeviceStore(s => s.connectedDeviceName);
  const channelName = useDeviceStore(s => s.channelName);
  const channelIndex = useDeviceStore(s => s.channelIndex);
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  const firmwareVersion = useDeviceStore(s => s.firmwareVersion);
  const hwModel = useDeviceStore(s => s.hwModel);
  const hasPKC = useDeviceStore(s => s.hasPKC);
  const lastPacketAt = useDeviceStore(s => s.lastPacketAt);
  const region = useDeviceStore(s => s.region);
  const keyFingerprint = useDeviceStore(s => s.channelKeyFingerprint);
  const [busy, setBusy] = useState(false);

  const close = () => useDeviceStore.getState().setDeviceSheetOpen(false);
  const meta = STATUS_META[status] ?? STATUS_META.disconnected;
  const isConnected = status === 'connected';

  // Same reconnect path as the ConnectionBar used to run: tear down any orphan
  // native state / pending retry timers, flag 'reconnecting', then connect.
  async function handleReconnect() {
    const lastDevice = await useDeviceStore.getState().loadLastDevice();
    const deviceId = useDeviceStore.getState().connectedDeviceId ?? lastDevice?.id;
    if (!deviceId) {
      Alert.alert('No saved device', 'There is no device to reconnect to. Re-pair from the onboarding flow (Reset RNDVU Pairing below).');
      return;
    }
    setBusy(true);
    bleService.disconnect();
    useDeviceStore.getState().setStatus('reconnecting');
    try {
      await bleService.connect(deviceId);
    } catch {
      useDeviceStore.getState().setStatus('disconnected');
    } finally {
      setBusy(false);
    }
  }

  function handleRelease() {
    Alert.alert(
      'Release Device?',
      'Disconnects RNDVU from your T-Echo so another app (like Meshtastic) can use it. Tap Reconnect here to return.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Release', onPress: () => bleService.disconnect() },
      ],
    );
  }

  function handleResetPairing() {
    Alert.alert(
      'Reset RNDVU Pairing?',
      'Forgets your device in RNDVU. Your messages and crew data are kept. You will re-pair on next launch.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              bleService.disconnect();
              await AsyncStorage.multiRemove(['rndvu_onboarding_complete', 'rndvu_last_device']);
            } catch {}
            Alert.alert('Reset complete', 'Close and reopen the app to start fresh pairing.');
          },
        },
      ],
    );
  }

  function handleFactoryReset() {
    Alert.alert(
      'Factory Reset T-Echo?',
      'Wipes your T-Echo completely — all settings, node history, and keys. It reboots, and RNDVU re-provisions the channel automatically when it reconnects. Use this if the device is stuck or was changed by another app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Factory Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              // Set the reprovision flag BEFORE the reset write — the post-reboot
              // reconnect fires a status transition the App.tsx listener catches
              // to re-run setChannel + setOwner. Setting it after could race.
              await AsyncStorage.setItem('rndvu_needs_reprovision', '1');
              await bleService.factoryReset();
              Alert.alert('Resetting Your T-Echo', 'Your T-Echo is rebooting. RNDVU will reconnect and re-provision the channel automatically. This takes about 15-20 seconds.');
            } catch (e) {
              console.warn('factory reset failed:', e);
              await AsyncStorage.removeItem('rndvu_needs_reprovision');
              Alert.alert('Reset Failed', 'Could not send factory reset. Make sure your device is connected, then try again.');
            }
          },
        },
      ],
    );
  }

  async function handleReprovision() {
    if (status !== 'connected' || !myNodeNum) {
      Alert.alert('Not connected', 'Connect to your T-Echo first, then re-provision.');
      return;
    }
    Alert.alert(
      'Re-provision device?',
      'Re-applies the RNDVU channel, encryption key, US region, and your name to this radio. It reboots and reconnects (~15-20s). Use this if Region shows UNSET or the channel/key looks wrong.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Re-provision',
          onPress: async () => {
            try {
              const saved = await useCrewStore.getState().loadDisplayName();
              if (saved) {
                try { await bleService.setOwner(saved.longName, saved.shortName); }
                catch (e) { console.warn('setOwner during re-provision failed:', e); }
              }
              await bleService.setChannel(0, RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK, 1);
              Alert.alert('Re-provisioning', 'Your radio is rebooting and will reconnect with the RNDVU channel + US region. Watch the Region field above flip to US.');
            } catch (e) {
              console.warn('re-provision failed:', e);
              // Leave the auto-retry flag set so the App reprovision listener
              // finishes the job on the next reconnect (matches onboarding).
              try { await AsyncStorage.setItem('rndvu_needs_reprovision', '1'); } catch {}
              Alert.alert('Re-provision Failed', "Couldn't finish re-provisioning. RNDVU will retry automatically when the device reconnects.");
            }
          },
        },
      ],
    );
  }

  const nodeIdHex = myNodeNum ? '!' + myNodeNum.toString(16).padStart(8, '0') : '—';
  const lastHeard = lastPacketAt ? timeAgo(Math.floor(lastPacketAt / 1000)) : 'never';
  // region 0 / null = UNSET → the radio receives but won't transmit. Flag it.
  const regionBad = region == null || region === 0;

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Device & Connection</Text>
          <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* Status */}
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
              <Text style={[styles.statusLabel, { color: meta.color }]}>{meta.label}</Text>
            </View>
            <Text style={styles.statusHint}>{meta.hint}</Text>
            <View style={styles.kv}><Text style={styles.k}>Device</Text><Text style={styles.v}>{deviceName ?? '—'}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>Channel</Text><Text style={styles.v}>{channelName}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>Last heard</Text><Text style={styles.v}>{lastHeard}</Text></View>
          </View>

          {/* Reconnect (only when not connected) */}
          {!isConnected && (
            <TouchableOpacity style={styles.primaryBtn} onPress={handleReconnect} disabled={busy} activeOpacity={0.8}>
              {busy
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>Reconnect</Text>}
            </TouchableOpacity>
          )}

          <Text style={styles.sectionTitle}>TROUBLESHOOTING</Text>

          <TouchableOpacity style={styles.action} onPress={handleReprovision}>
            <Text style={styles.actionTitle}>{regionBad ? '⚠ Re-provision Device' : 'Re-provision Device'}</Text>
            <Text style={styles.actionSub}>Re-apply the RNDVU channel, key, US region, and your name. Fixes an UNSET region or wrong channel/key — no factory reset or re-pair needed.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.action} onPress={handleRelease}>
            <Text style={styles.actionTitle}>Release Device</Text>
            <Text style={styles.actionSub}>Hand the radio to the Meshtastic app or for OTA updates.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.action} onPress={handleResetPairing}>
            <Text style={styles.actionTitle}>Reset RNDVU Pairing</Text>
            <Text style={styles.actionSub}>Forget the device in RNDVU and re-pair. Your messages are kept.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.action, styles.danger]} onPress={handleFactoryReset}>
            <Text style={[styles.actionTitle, { color: Colors.error }]}>Factory Reset T-Echo</Text>
            <Text style={styles.actionSub}>Wipe the radio and let RNDVU re-provision it. Fixes "won't connect" or channel drift after another app changed it.</Text>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>DIAGNOSTICS</Text>
          <View style={styles.diag}>
            <View style={styles.kv}>
              <Text style={styles.k}>Region</Text>
              <Text style={[styles.vMono, regionBad && { color: Colors.error }]}>
                {regionName(region)}{regionBad ? " — won't transmit" : ''}
              </Text>
            </View>
            <View style={styles.kv}><Text style={styles.k}>Channel key</Text><Text style={styles.vMono}>{keyFingerprint ?? '—'}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>Channel index</Text><Text style={styles.vMono}>{channelIndex ?? '—'}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>Node ID</Text><Text style={styles.vMono}>{nodeIdHex}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>Firmware</Text><Text style={styles.vMono}>{firmwareVersion ?? '—'}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>HW model</Text><Text style={styles.vMono}>{hwModel ?? '—'}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>PKC</Text><Text style={styles.vMono}>{hasPKC == null ? '—' : hasPKC ? 'yes' : 'no'}</Text></View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1d2a',
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary },
  close: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl },
  statusCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusLabel: { fontSize: FontSize.lg, fontWeight: '800' },
  statusHint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4, marginBottom: Spacing.sm },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { fontSize: FontSize.sm, color: Colors.textSecondary },
  v: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '600' },
  vMono: { fontSize: FontSize.sm, color: Colors.textPrimary, fontFamily: 'monospace' },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.full,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  primaryBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '800' },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  action: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  danger: { borderColor: Colors.error + '44' },
  actionTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  actionSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 3 },
  diag: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
});
