import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { Colors } from './src/config/theme';
import TabNavigator from './src/navigation/TabNavigator';
import ErrorBoundary from './src/components/common/ErrorBoundary';
import OnboardingScreen from './src/screens/OnboardingScreen';
import DeviceScreen from './src/screens/DeviceScreen';
import { useMessagesStore, flushPendingPersist } from './src/store/useMessagesStore';
import { useDeviceStore, waitForMyNode } from './src/store/useDeviceStore';
import { useCrewStore } from './src/store/useCrewStore';
import { useMapCalibrationStore } from './src/store/useMapCalibrationStore';
import { useTagStore } from './src/store/useTagStore';
import { useScheduleStore } from './src/store/useScheduleStore';
import { bleService } from './src/services/ble/BleManager';
import { RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK } from './src/services/ble/MeshtasticCodec';
import { routeFromRadio } from './src/services/ble/PacketRouter';

const DISPLAY_NAME_KEY = 'rndvu_display_name';
const ONBOARDING_COMPLETE_KEY = 'rndvu_onboarding_complete';
const NEEDS_REPROVISION_KEY = 'rndvu_needs_reprovision';

const RNDVUNavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.background,
    card: Colors.surface,
    text: Colors.textPrimary,
    border: '#1e1d2a',
    primary: Colors.primary,
    notification: Colors.primary,
  },
};

export default function App() {
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const loadMessages = useMessagesStore(s => s.loadMessages);
  const loadMyColor = useCrewStore(s => s.loadMyColor);
  const loadCrewMembers = useCrewStore(s => s.loadCrewMembers);
  const loadAnchors = useMapCalibrationStore(s => s.loadAnchors);
  const loadTags = useTagStore(s => s.loadTags);
  const loadMyGoingPicks = useScheduleStore(s => s.loadMyGoingPicks);
  const unsubRef = useRef<{ packet?: () => void; status?: () => void }>({});
  const gpsSubRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    // Register BLE listeners unconditionally so packets + status updates flow
    // into the store regardless of which screen is mounted. Without this,
    // fresh onboarding leaves the main app with no listeners (tryAutoReconnect
    // returns early on null lastDevice), and mesh packets get dropped.
    unsubRef.current.packet = bleService.onPacket((fromRadio) => {
      const myNodeNum = useDeviceStore.getState().myNodeNum;
      routeFromRadio(fromRadio, myNodeNum);
    });
    unsubRef.current.status = bleService.onStatus((status) => {
      // Pass through directly — the BLE layer now emits 'reconnecting' during
      // auto-retry, so coercing to binary connected/disconnected would hide
      // active recovery from the ConnectionBar.
      useDeviceStore.getState().setStatus(status);
    });

    loadMessages();
    loadMyColor();
    loadCrewMembers();
    loadAnchors();
    loadTags();
    loadMyGoingPicks();
    startPhoneGps();
    loadOnboardingStateAndReconnect();

    return () => {
      unsubRef.current.packet?.();
      unsubRef.current.status?.();
      stopPhoneGps();
    };
  }, []);

  // After a factory reset or any other path that leaves the T-Echo blank,
  // catch the post-reboot reconnect and re-run setChannel + setOwner. Flag
  // is set by the Factory Reset action and cleared once reprovision succeeds.
  useEffect(() => {
    let prevStatus = useDeviceStore.getState().status;
    const unsub = useDeviceStore.subscribe((state) => {
      if (prevStatus !== 'connected' && state.status === 'connected') {
        tryReprovisionIfNeeded();
      }
      prevStatus = state.status;
    });
    return unsub;
  }, []);

  async function tryReprovisionIfNeeded() {
    let needs = false;
    try {
      needs = (await AsyncStorage.getItem(NEEDS_REPROVISION_KEY)) === '1';
    } catch {}
    if (!needs) return;

    // Wait for the config drain so myNodeNum is populated before admin writes.
    const nodeNum = await waitForMyNode(10000);
    if (nodeNum === null) {
      console.warn('reprovision: waitForMyNode timed out, will retry on next reconnect');
      return;
    }

    try {
      // Rehydrate the display name (factory reset wiped it on the device side).
      const raw = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
      const savedName = raw ? (JSON.parse(raw) as { longName: string; shortName: string }) : null;
      if (savedName) {
        try { await bleService.setOwner(savedName.longName, savedName.shortName); } catch (e) {
          console.warn('reprovision setOwner failed:', e);
        }
      }
      // Re-provision the channel. setChannel triggers another reboot; the
      // next reconnect will find the flag cleared and skip this path.
      await bleService.setChannel(0, RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK, 1);
      await AsyncStorage.removeItem(NEEDS_REPROVISION_KEY);
    } catch (e) {
      console.warn('reprovision failed (will retry on next reconnect):', e);
    }
  }

  // T-Echo holds only one BLE central at a time. On background, release the
  // slot so the Meshtastic app (for OTA, debug, or anything we haven't ported
  // into RNDVU) can connect cleanly. On foreground, reconnect via saved
  // lastDevice. Gated on onboardingComplete so initial pairing isn't disturbed
  // by a mid-flow background event.
  useEffect(() => {
    if (!onboardingComplete) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        // Flush the message buffer so the last few seconds survive a suspend/kill.
        flushPendingPersist();
        // Stop the GPS watcher while backgrounded (we release the BLE slot too)
        // and re-acquire on foreground.
        stopPhoneGps();
        const { status } = useDeviceStore.getState();
        if (status === 'connected' || status === 'connecting' || status === 'reconnecting') {
          bleService.disconnect();
        }
      } else if (nextState === 'active') {
        startPhoneGps();
        reconnectOnForeground();
      }
    });
    return () => sub.remove();
  }, [onboardingComplete]);

  async function reconnectOnForeground() {
    const { status } = useDeviceStore.getState();
    if (status === 'connected' || status === 'connecting' || status === 'reconnecting') return;
    const lastDevice = await useDeviceStore.getState().loadLastDevice();
    if (!lastDevice) return;
    useDeviceStore.getState().setStatus('reconnecting');
    useDeviceStore.getState().setConnectedDevice(lastDevice.id, lastDevice.name);
    try {
      await bleService.connect(lastDevice.id);
    } catch {
      useDeviceStore.getState().setStatus('disconnected');
    }
  }

  async function startPhoneGps() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    // Get an immediate fix so the map has a location on first render
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      useCrewStore.getState().setMyLocation(loc.coords.latitude, loc.coords.longitude, true);
    } catch {}

    // Replace any prior watcher (e.g. across a background/foreground cycle) so
    // subscriptions don't stack. fromPhone=true marks this as the high-accuracy
    // source so the radio's self-position can't override it.
    gpsSubRef.current?.remove();
    gpsSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 5 },
      (loc) => {
        useCrewStore.getState().setMyLocation(loc.coords.latitude, loc.coords.longitude, true);
      },
    );
  }

  function stopPhoneGps() {
    gpsSubRef.current?.remove();
    gpsSubRef.current = null;
  }

  async function loadOnboardingStateAndReconnect() {
    // Trust the persisted onboarding flag — don't gate the main app on a
    // successful BLE reconnect. If the user has onboarded before, show the
    // main app immediately and let ConnectionBar handle reconnect UX.
    let hasOnboarded = false;
    try {
      hasOnboarded = (await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)) === 'true';
    } catch {}

    if (hasOnboarded) {
      setOnboardingComplete(true);
    }
    setIsLoading(false);

    const lastDevice = await useDeviceStore.getState().loadLastDevice();
    if (!lastDevice) return;

    // Load saved display name
    let savedName: { longName: string; shortName: string } | null = null;
    try {
      const raw = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
      if (raw) savedName = JSON.parse(raw);
    } catch {}

    try {
      useDeviceStore.getState().setStatus('reconnecting');
      useDeviceStore.getState().setConnectedDevice(lastDevice.id, lastDevice.name);
      await bleService.connect(lastDevice.id);

      // Re-apply display name — both locally and on the device. The setOwner
      // write ensures the T-Echo broadcasts the RNDVU name over NodeInfo so
      // peers see the right name instead of "Unknown". Wait on the real
      // signal (myNodeNum populated from config drain) rather than guessing a
      // delay — slow drains used to miss the window and throw.
      if (savedName) {
        (async () => {
          const nodeNum = await waitForMyNode(10000);
          useCrewStore.getState().setDisplayName(savedName!.longName, savedName!.shortName);
          if (nodeNum === null) {
            console.warn('waitForMyNode timed out on auto-reconnect; skipping setOwner');
            return;
          }
          try {
            await bleService.setOwner(savedName!.longName, savedName!.shortName);
          } catch (e) {
            console.warn('setOwner on auto-reconnect failed (non-fatal):', e);
          }
        })();
      }
    } catch (error) {
      console.warn('Auto-reconnect failed:', error);
      useDeviceStore.getState().setStatus('disconnected');
    }
  }

  if (isLoading) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <StatusBar style="light" backgroundColor={Colors.background} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <StatusBar style="light" backgroundColor={Colors.background} />
          {!onboardingComplete ? (
            <OnboardingScreen onComplete={() => setOnboardingComplete(true)} />
          ) : (
            <NavigationContainer theme={RNDVUNavTheme}>
              <TabNavigator />
            </NavigationContainer>
          )}
          {/* Device/Connection troubleshooting sheet — opened from the tappable
              ConnectionBar and the header gear; self-controlled via the store. */}
          <DeviceScreen />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
});
