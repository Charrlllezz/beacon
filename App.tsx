import React, { useState, useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, StyleSheet } from 'react-native';

import { Colors } from './src/config/theme';
import TabNavigator from './src/navigation/TabNavigator';
import ErrorBoundary from './src/components/common/ErrorBoundary';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { useMessagesStore } from './src/store/useMessagesStore';
import { useDeviceStore } from './src/store/useDeviceStore';
import { useCrewStore } from './src/store/useCrewStore';
import { useMapCalibrationStore } from './src/store/useMapCalibrationStore';

const BeaconNavTheme = {
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
  const loadMessages = useMessagesStore(s => s.loadMessages);
  const loadMyColor = useCrewStore(s => s.loadMyColor);
  const loadAnchors = useMapCalibrationStore(s => s.loadAnchors);
  const status = useDeviceStore(s => s.status);

  useEffect(() => {
    loadMessages();
    loadMyColor();
    loadAnchors();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <StatusBar style="light" backgroundColor={Colors.background} />
          {!onboardingComplete ? (
            <OnboardingScreen onComplete={() => setOnboardingComplete(true)} />
          ) : (
            <NavigationContainer theme={BeaconNavTheme}>
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
