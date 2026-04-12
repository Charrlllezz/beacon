import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Colors } from './src/config/theme';
import TabNavigator from './src/navigation/TabNavigator';
import ErrorBoundary from './src/components/common/ErrorBoundary';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { useMessagesStore } from './src/store/useMessagesStore';
import { useDeviceStore } from './src/store/useDeviceStore';
import { useCrewStore } from './src/store/useCrewStore';
import { useMapCalibrationStore } from './src/store/useMapCalibrationStore';
import { useTagStore } from './src/store/useTagStore';
import { bleService } from './src/services/ble/BleManager';
import { routeFromRadio } from './src/services/ble/PacketRouter';

const DISPLAY_NAME_KEY = 'rndvu_display_name';

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
  const loadAnchors = useMapCalibrationStore(s => s.loadAnchors);
  const loadTags = useTagStore(s => s.loadTags);
  const unsubRef = useRef<{ packet?: () => void; status?: () => void }>({});

  useEffect(() => {
    loadMessages();
    loadMyColor();
    loadAnchors();
    loadTags();
    tryAutoReconnect();

    return () => {
      unsubRef.current.packet?.();
      unsubRef.current.status?.();
    };
  }, []);

  async function tryAutoReconnect() {
    const lastDevice = await useDeviceStore.getState().loadLastDevice();
    if (!lastDevice) {
      setIsLoading(false);
      return;
    }

    // Load saved display name
    let savedName: { longName: string; shortName: string } | null = null;
    try {
      const raw = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
      if (raw) savedName = JSON.parse(raw);
    } catch {}

    // Set up packet routing
    unsubRef.current.packet = bleService.onPacket((fromRadio) => {
      const myNodeNum = useDeviceStore.getState().myNodeNum;
      routeFromRadio(fromRadio, myNodeNum);
    });

    unsubRef.current.status = bleService.onStatus((status) => {
      useDeviceStore.getState().setStatus(status === 'connected' ? 'connected' : 'disconnected');
    });

    try {
      useDeviceStore.getState().setStatus('reconnecting');
      useDeviceStore.getState().setConnectedDevice(lastDevice.id, lastDevice.name);
      await bleService.connect(lastDevice.id);
      useDeviceStore.getState().setStatus('connected');

      // Re-apply display name after device sends its defaults
      if (savedName) {
        setTimeout(() => {
          useCrewStore.getState().setDisplayName(savedName!.longName, savedName!.shortName);
        }, 2500);
      }

      setOnboardingComplete(true);
    } catch (error) {
      console.warn('Auto-reconnect failed:', error);
      useDeviceStore.getState().setStatus('disconnected');
      // Clean up subscriptions so onboarding can set them up fresh
      unsubRef.current.packet?.();
      unsubRef.current.status?.();
      unsubRef.current = {};
    }

    setIsLoading(false);
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
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
});
