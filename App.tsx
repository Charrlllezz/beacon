import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, AppState, Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { Colors } from './src/config/theme';
import TabNavigator from './src/navigation/TabNavigator';
import ErrorBoundary from './src/components/common/ErrorBoundary';
import OnboardingScreen from './src/screens/OnboardingScreen';
import DeviceScreen from './src/screens/DeviceScreen';
import EndTripSheet from './src/components/debrief/EndTripSheet';
import { useMessagesStore, flushPendingPersist, setPersistImmediately } from './src/store/useMessagesStore';
import { useDeviceStore, waitForMyNode } from './src/store/useDeviceStore';
import { useCrewStore } from './src/store/useCrewStore';
import { useTagStore } from './src/store/useTagStore';
import { useScheduleStore } from './src/store/useScheduleStore';
import { useFestivalStore } from './src/store/useFestivalStore';
import { useOfflineMapStore } from './src/store/useOfflineMapStore';
import { useCrewKeyStore } from './src/store/useCrewKeyStore';
import { festivalConfig } from './src/services/festival/FestivalConfig';
import { bleService } from './src/services/ble/BleManager';
import { provisionRadio } from './src/services/crew/crewActions';
import { confirmJoin } from './src/services/crew/confirmJoin';
import { routeFromRadio, onMeshMessage } from './src/services/ble/PacketRouter';
import {
  configureNotifications,
  notifyForMessage,
  requestNotificationPermission,
  scheduleMeetupReminder,
  cancelMeetupReminder,
  notifyFindRequest,
  clearFindRequest,
  findRequestFromResponse,
} from './src/services/notifications/LocalNotifications';
import * as Notifications from 'expo-notifications';
import { tickFind, startHelping } from './src/services/find/FindController';
import { useFindStore } from './src/store/useFindStore';
import HelpFindSheet from './src/components/crew/HelpFindSheet';
import { reminderActions } from './src/services/notifications/meetupReminderSync';
import { notificationContext } from './src/utils/sos';
import { loadActiveSos, tickSos, hiddenSos } from './src/services/sos/SosController';
import { getLocationLabel } from './src/components/chat/MeetupCard';
import { hapticWarning } from './src/utils/haptics';

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

  // Get the active festival's offline map onto the phone without anyone
  // opening the Map tab: on launch and whenever the festival changes. Only
  // while visible: a background BLE wake is a few seconds, not a download slot.
  useEffect(() => {
    if (AppState.currentState !== 'active') return;
    useOfflineMapStore.getState().ensure(festivalConfig.getConfig());
  }, [activeFestivalId]);
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
      const myNodeNum = useDeviceStore.getState().myNodeNum;
      const ctx = notificationContext(useMessagesStore.getState().messages, message, myNodeNum, hiddenSos);
      notifyForMessage(message, myNodeNum, ctx.replyTarget, ctx.sos);
    });
    // An active SOS repeats every 2 minutes. JS timers stop while iOS has us
    // suspended, so also check on every packet from the radio: each one wakes
    // the app. Both no-op unless something is due.
    loadActiveSos().then(() => tickSos());
    const sosTimer = setInterval(() => { tickSos(); }, 15_000);
    const unsubSosWake = bleService.onPacket(() => { tickSos(); });
    // Find me runs the same way: a timer in the foreground, every radio
    // packet in the background.
    const findTimer = setInterval(() => { tickFind(); }, 5_000);
    const unsubFindWake = bleService.onPacket(() => { tickFind(); });
    // Someone is looking for me: an alert if I'm in the app, a time-sensitive
    // notification if not. A cancelled or answered request clears it.
    const unsubFindRequests = useFindStore.subscribe((state, prev) => {
      if (state.incoming === prev.incoming) return;
      if (prev.incoming && prev.incoming.finder !== state.incoming?.finder) clearFindRequest(prev.incoming.finder);
      const req = state.incoming;
      if (!req) return;
      if (AppState.currentState === 'active') {
        hapticWarning();
        Alert.alert(
          `${req.finderName} is looking for you`,
          'Help them find you? Your phone shares your exact spot with them for 10 minutes.',
          [
            { text: 'Not now', style: 'cancel', onPress: () => useFindStore.getState().setIncoming(null) },
            { text: 'Help them find me', onPress: () => { startHelping(req.finder, req.finderName); } },
          ],
        );
      } else {
        notifyFindRequest(req.finder, req.finderName);
      }
    });
    const onFindResponse = (r: Notifications.NotificationResponse | null) => {
      const req = findRequestFromResponse(r);
      if (!req) return;
      Notifications.clearLastNotificationResponse();
      if (req.help) startHelping(req.finder, req.finderName);
      else useFindStore.getState().setIncoming(null);
    };
    const findResponses = Notifications.addNotificationResponseReceivedListener(onFindResponse);
    // Launched by tapping the notification.
    onFindResponse(Notifications.getLastNotificationResponse());

    // Meetup reminders follow the message list: new meetups (sent, received,
    // or loaded at launch) get one; my "Can't make it" drops it.
    const unsubReminders = useMessagesStore.subscribe((state, prev) => {
      if (state.messages === prev.messages) return;
      const { schedule, cancel } = reminderActions(prev.messages, state.messages, useDeviceStore.getState().myNodeNum);
      for (const meetup of schedule) scheduleMeetupReminder(meetup, getLocationLabel(meetup.location));
      for (const id of cancel) cancelMeetupReminder(id);
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
    useCrewKeyStore.getState().load();
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
      unsubReminders();
      clearInterval(sosTimer);
      unsubSosWake();
      clearInterval(findTimer);
      unsubFindWake();
      unsubFindRequests();
      findResponses.remove();
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
      // Re-provision channel + name in one transaction. It ends in a reboot;
      // the next reconnect finds the flag cleared and skips this path. With
      // Model 2 and no crew yet there's nothing to write until the user
      // starts or joins one (which writes it then), so the flag stays.
      const result = await provisionRadio(savedName ?? undefined);
      if (result === 'written') await AsyncStorage.removeItem(NEEDS_REPROVISION_KEY);
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
        // Resume/retry the offline map (no-op when complete or running).
        useOfflineMapStore.getState().ensure(festivalConfig.getConfig());
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

  // Crew invites opened from outside the app (the iPhone camera on an RNDVU
  // QR, or a shared rndvu://join link). Before setup is finished there's no
  // radio to put the key on, so ask them to scan again from onboarding.
  useEffect(() => {
    if (isLoading) return;
    const handle = (url: string | null) => {
      if (!url || !url.toLowerCase().startsWith('rndvu://join')) return;
      if (!onboardingComplete) {
        Alert.alert('Set up first', "Finish connecting your radio, then choose Join with a QR and scan the invite again.");
        return;
      }
      confirmJoin(url);
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [isLoading, onboardingComplete]);

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
          <EndTripSheet />
          <HelpFindSheet />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
});
