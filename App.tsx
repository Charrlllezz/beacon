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
import { useMessagesStore, flushPendingPersist, setPersistImmediately } from './src/store/useMessagesStore';
import { useDeviceStore, waitForMyNode } from './src/store/useDeviceStore';
import { useCrewStore } from './src/store/useCrewStore';
import { useTagStore } from './src/store/useTagStore';
import { useScheduleStore } from './src/store/useScheduleStore';
import { useFestivalStore } from './src/store/useFestivalStore';
import { bleService } from './src/services/ble/BleManager';
import { RNDVU_CHANNEL_NAME, RNDVU_CHANNEL_PSK } from './src/services/ble/MeshtasticCodec';
import { routeFromRadio, onMeshMessage } from './src/services/ble/PacketRouter';
import {
  configureNotifications,
  notifyForMessage,
  requestNotificationPermission,
} from './src/services/notifications/LocalNotifications';

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
  const loadTags = useTagStore(s => s.loadTags);
  const loadMyGoingPicks = useScheduleStore(s => s.loadMyGoingPicks);
  // Screens read the festival config during render; keying the tabs on the
  // active id remounts them when it changes (rare: first GPS fix near a
  // different venue, a date rollover, or a manual pick in the Device sheet).
  const activeFestivalId = useFestivalStore(s => s.activeId);
  const unsubRef = useRef<{ packet?: () => void; status?: () => void; notify?: () => void }>({});
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

    // Local notifications for crew messages that arrive while backgrounded.
    // The policy (NotificationPolicy) decides; foreground arrivals stay silent.
    configureNotifications();
    unsubRef.current.notify = onMeshMessage((message) => {
      notifyForMessage(message, useDeviceStore.getState().myNodeNum);
    });

    // We may be starting in the background (iOS relaunching us for a BLE
    // event via state restoration), so sync app-state-dependent behaviour now
    // rather than waiting for the first AppState change.
    const startedActive = AppState.currentState === 'active';
    bleService.setAppActive(startedActive);
    setPersistImmediately(!startedActive);

    loadMessages();
    loadMyColor();
    loadCrewMembers();
    loadTags();
    loadMyGoingPicks();
    useFestivalStore.getState().loadOverride();
    // Re-pick the festival on the first phone GPS fix (location can narrow
    // the pick to the venue you're at). One-shot: later moves don't flip it.
    const unsubFirstFix = useCrewStore.subscribe((state) => {
      if (state.myLocation && state.myLocationIsPhone) {
        unsubFirstFix();
        useFestivalStore.getState().refresh(new Date(), state.myLocation);
      }
    });
    // Phone GPS is foreground-only (battery); a background relaunch skips it
    // and the 'active' transition below starts it.
    if (startedActive) startPhoneGps();
    loadOnboardingStateAndReconnect();

    return () => {
      unsubRef.current.packet?.();
      unsubRef.current.status?.();
      unsubRef.current.notify?.();
      unsubFirstFix();
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

  // Background: KEEP the radio. A phone locked in a pocket is the normal case
  // at a festival, and iOS (bluetooth-central background mode) keeps the GATT
  // session up and wakes us per FROM_NUM notify, so messages, rally points and
  // SOS still arrive and notify. Handing the radio to the Meshtastic app is now
  // an explicit Release Device tap (DeviceScreen), not a side effect of
  // switching apps. Phone GPS still stops: peers see us via the T-Echo's own
  // position broadcasts, which never depended on the phone.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        // Flush the message buffer so the last few seconds survive a suspend/kill,
        // and write background arrivals immediately from here on.
        setPersistImmediately(true);
        flushPendingPersist();
        stopPhoneGps();
        bleService.setAppActive(false);
      } else if (nextState === 'active') {
        setPersistImmediately(false);
        bleService.setAppActive(true);
        startPhoneGps();
        // Dates move on while the app sits in a pocket for days.
        useFestivalStore.getState().refresh();
      }
    });
    return () => sub.remove();
  }, []);

  // On foreground, reconnect via saved lastDevice if the link is down (and the
  // user didn't release it). Gated on onboardingComplete so initial pairing
  // isn't disturbed by a mid-flow app switch.
  useEffect(() => {
    if (!onboardingComplete) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        reconnectOnForeground();
        // Users who onboarded before notifications existed get asked here
        // (no-op once answered).
        requestNotificationPermission();
      }
    });
    return () => sub.remove();
  }, [onboardingComplete]);

  async function reconnectOnForeground() {
    const { status, released } = useDeviceStore.getState();
    if (released) return;
    if (status === 'connected' || status === 'connecting' || status === 'reconnecting') return;
    const lastDevice = await useDeviceStore.getState().loadLastDevice();
    if (!lastDevice) return;
    useDeviceStore.getState().setStatus('reconnecting');
    useDeviceStore.getState().setConnectedDevice(lastDevice.id, lastDevice.name);
    try {
      // autoRetry: if the radio is out of range, keep waiting for it (through
      // a later background stretch too) rather than giving up here. Status
      // updates come from the BLE layer.
      await bleService.connect(lastDevice.id, { autoRetry: true });
    } catch {}
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
      // Covers users who onboarded before notifications existed. Only when
      // visible: a background relaunch can't show the prompt.
      if (AppState.currentState === 'active') requestNotificationPermission();
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
      // autoRetry: radio off or out of range at launch → keep trying, and hand
      // off to a pending connect once backgrounded. Also adopts a link iOS
      // restored when it relaunched us in the background.
      await bleService.connect(lastDevice.id, { autoRetry: true });

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
      // Retries continue in the BLE layer, which owns the status from here.
      console.warn('Auto-reconnect failed (retrying):', error);
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
              <TabNavigator key={activeFestivalId} />
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
