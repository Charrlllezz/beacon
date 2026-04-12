import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Animated, ActivityIndicator, TextInput, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '../config/theme';
import { useDeviceStore } from '../store/useDeviceStore';
import { useCrewStore } from '../store/useCrewStore';
import { bleService } from '../services/ble/BleManager';
import { routeFromRadio } from '../services/ble/PacketRouter';
import { useMessagesStore } from '../store/useMessagesStore';

interface Props {
  onComplete: () => void;
}

type Step = 'welcome' | 'name' | 'scanning' | 'select' | 'connecting' | 'done';

export default function OnboardingScreen({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [shortName, setShortName] = useState('');
  const [crewCount, setCrewCount] = useState(0);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const discoveredDevices = useDeviceStore(s => s.discoveredDevices);
  const addDiscoveredDevice = useDeviceStore(s => s.addDiscoveredDevice);
  const clearDiscoveredDevices = useDeviceStore(s => s.clearDiscoveredDevices);
  const setStatus = useDeviceStore(s => s.setStatus);
  const setConnectedDevice = useDeviceStore(s => s.setConnectedDevice);
  const unsubscribeRef = useRef<{ packet?: () => void; status?: () => void }>({});

  // Pre-fill saved display name if returning to onboarding
  useEffect(() => {
    useCrewStore.getState().loadDisplayName().then((saved) => {
      if (saved) {
        setDisplayName(saved.longName);
        setShortName(saved.shortName);
      }
    });
  }, []);

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

    try {
      await bleService.connect(deviceId);
      setStatus('connected');

      await new Promise(r => setTimeout(r, 2200));

      // Re-apply display name over the device's default name
      if (displayName.trim()) {
        const short = shortName.trim() || displayName.trim().slice(0, 4);
        useCrewStore.getState().setDisplayName(displayName.trim(), short);
      }

      // Save device for auto-reconnect
      useDeviceStore.getState().saveLastDevice();

      const finalCount = Object.values(useCrewStore.getState().crewMembers).filter(m => !m.isSelf).length;
      setCrewCount(finalCount);
      setStep('done');
    } catch (e) {
      console.warn('Connection failed:', e);
      setStatus('disconnected');
      setStep('select');
      Alert.alert('Connection Failed', 'Could not connect to device. Make sure it is powered on and nearby, then try again.');
    }
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
            <Text style={styles.appName}>RNDVU</Text>
            <Text style={styles.tagline}>
              Never miss the rendezvous.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => setStep('name')}>
              <Text style={styles.primaryButtonText}>Get Started</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'name' && (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              contentContainerStyle={styles.centered}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.appName}>What's your name?</Text>
              <Text style={styles.tagline}>This is how your crew will see you</Text>
              <TextInput
                style={styles.nameInput}
                placeholder="Display name (e.g. Charles)"
                placeholderTextColor={Colors.textMuted}
                value={displayName}
                onChangeText={(text) => {
                  setDisplayName(text);
                  if (!shortName || shortName === displayName.slice(0, 4)) {
                    setShortName(text.slice(0, 4));
                  }
                }}
                maxLength={20}
                autoFocus
                keyboardAppearance="dark"
              />
              <TextInput
                style={[styles.nameInput, { marginTop: Spacing.sm }]}
                placeholder="Short name (e.g. Char)"
                placeholderTextColor={Colors.textMuted}
                value={shortName}
                onChangeText={setShortName}
                maxLength={4}
                keyboardAppearance="dark"
              />
              <Text style={styles.hintText}>Short name: 4 chars max, shown on map pins</Text>
              <TouchableOpacity
                style={[styles.primaryButton, !displayName.trim() && styles.primaryButtonDisabled]}
                onPress={() => {
                  if (displayName.trim()) {
                    useCrewStore.getState().setDisplayName(displayName.trim(), shortName.trim() || displayName.trim().slice(0, 4));
                    useMessagesStore.getState().clearMessages();
                    handleScan();
                  }
                }}
                disabled={!displayName.trim()}
              >
                <Text style={styles.primaryButtonText}>Connect Your Device</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {step === 'scanning' && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.statusText}>Looking for RNDVU devices…</Text>
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
            <View style={styles.selectActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleScan}>
                <Text style={styles.secondaryButtonText}>Scan Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setStep('name')}>
                <Text style={styles.secondaryButtonText}>Back</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {step === 'connecting' && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.statusText}>Joining the mesh…</Text>
            <Text style={styles.hintText}>Setting your rendezvous</Text>
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
              <Text style={styles.primaryButtonText}>Go to RNDVU →</Text>
            </TouchableOpacity>
          </View>
        )}

      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
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
    textAlign: 'center',
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
  primaryButtonDisabled: {
    backgroundColor: Colors.textMuted,
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
    textAlign: 'center',
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
  nameInput: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xs,
  },
  selectActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
});
