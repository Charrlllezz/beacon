import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Animated, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '../config/theme';
import { useDeviceStore } from '../store/useDeviceStore';
import { useCrewStore } from '../store/useCrewStore';
import { bleService } from '../services/ble/BleManager';
import { routeFromRadio } from '../services/ble/PacketRouter';

interface Props {
  onComplete: () => void;
}

type Step = 'welcome' | 'scanning' | 'select' | 'connecting' | 'done';

export default function OnboardingScreen({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [crewCount, setCrewCount] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const discoveredDevices = useDeviceStore(s => s.discoveredDevices);
  const addDiscoveredDevice = useDeviceStore(s => s.addDiscoveredDevice);
  const clearDiscoveredDevices = useDeviceStore(s => s.clearDiscoveredDevices);
  const setStatus = useDeviceStore(s => s.setStatus);
  const setConnectedDevice = useDeviceStore(s => s.setConnectedDevice);
  const unsubscribeRef = useRef<{ packet?: () => void; status?: () => void }>({});

  // Clean up BLE listeners on unmount
  useEffect(() => {
    return () => {
      unsubscribeRef.current.packet?.();
      unsubscribeRef.current.status?.();
    };
  }, []);

  useEffect(() => {
    const fade = Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true });
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    fade.start();
    pulse.start();
    return () => { fade.stop(); pulse.stop(); };
  }, []);

  async function handleScan() {
    setStep('scanning');
    clearDiscoveredDevices();
    setStatus('scanning');
    const devices = await bleService.scanAndConnect();
    for (const d of devices) {
      addDiscoveredDevice({ id: d.id, name: d.name, rssi: -65 });
    }
    setStep('select');
  }

  async function handleConnect(deviceId: string, deviceName: string) {
    setStep('connecting');
    setStatus('connecting');
    setConnectedDevice(deviceId, deviceName);

    unsubscribeRef.current.packet = bleService.onPacket((fromRadio) => {
      const myNodeNum = useDeviceStore.getState().myNodeNum;
      routeFromRadio(fromRadio, myNodeNum);
      const members = useCrewStore.getState().crewMembers;
      const count = Object.values(members).filter(m => !m.isSelf).length;
      setCrewCount(count);
    });

    unsubscribeRef.current.status = bleService.onStatus((status) => {
      setStatus(status === 'connected' ? 'connected' : 'disconnected');
    });

    await bleService.connect(deviceId);
    setStatus('connected');

    // Wait for initial data flush
    await new Promise(r => setTimeout(r, 2200));
    const finalCount = Object.values(useCrewStore.getState().crewMembers).filter(m => !m.isSelf).length;
    setCrewCount(finalCount);
    setStep('done');
  }

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>

        {step === 'welcome' && (
          <View style={styles.centered}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoEmoji}>📡</Text>
              </View>
            </Animated.View>
            <Text style={styles.appName}>Beacon</Text>
            <Text style={styles.tagline}>
              Find your crew{'\n'}when cell service dies.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleScan}>
              <Text style={styles.primaryButtonText}>Connect Your Beacon Device</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'scanning' && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.statusText}>Looking for Beacon devices…</Text>
            <Text style={styles.hintText}>Make sure your device is powered on</Text>
          </View>
        )}

        {step === 'select' && (
          <View style={styles.selectContainer}>
            <Text style={styles.selectTitle}>
              Found {discoveredDevices.length} device{discoveredDevices.length !== 1 ? 's' : ''}
            </Text>
            <Text style={styles.selectSubtitle}>Tap your device to connect</Text>
            <FlatList
              data={discoveredDevices}
              keyExtractor={d => d.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.deviceCard}
                  onPress={() => handleConnect(item.id, item.name)}
                >
                  <Text style={styles.deviceIcon}>📟</Text>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{item.name}</Text>
                    <Text style={styles.deviceSignal}>● Signal: Strong</Text>
                  </View>
                  <Text style={styles.connectArrow}>→</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {step === 'connecting' && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.statusText}>Joining the mesh…</Text>
            <Text style={styles.hintText}>Finding your crew</Text>
          </View>
        )}

        {step === 'done' && (
          <View style={styles.centered}>
            <View style={[styles.logoCircle, { backgroundColor: Colors.success + '22', borderColor: Colors.success + '55' }]}>
              <Text style={styles.logoEmoji}>✓</Text>
            </View>
            <Text style={styles.appName}>You're In!</Text>
            <Text style={styles.tagline}>
              {crewCount > 0
                ? `${crewCount} crew member${crewCount !== 1 ? 's' : ''} online`
                : 'Connected to the mesh'}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={onComplete}>
              <Text style={styles.primaryButtonText}>Go to Beacon →</Text>
            </TouchableOpacity>
          </View>
        )}

      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  logoCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    borderWidth: 2,
    borderColor: Colors.primary + '55',
  },
  logoEmoji: { fontSize: 52 },
  appName: {
    fontSize: 44,
    fontWeight: '900',
    color: Colors.textPrimary,
    letterSpacing: -1,
    marginBottom: Spacing.sm,
  },
  tagline: {
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: Spacing.xxl,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
    minWidth: 260,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  statusText: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    marginTop: Spacing.lg,
    fontWeight: '600',
  },
  hintText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    marginTop: Spacing.sm,
  },
  selectContainer: {
    flex: 1,
    padding: Spacing.lg,
    paddingTop: Spacing.xxl,
  },
  selectTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  selectSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
  },
  deviceCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  deviceIcon: { fontSize: 28, marginRight: Spacing.md },
  deviceInfo: { flex: 1 },
  deviceName: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  deviceSignal: {
    color: Colors.success,
    fontSize: FontSize.xs,
    marginTop: 3,
  },
  connectArrow: {
    color: Colors.primary,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
});
