import React from 'react';
import { Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useDeviceStore } from '../../store/useDeviceStore';
import { Colors, FontSize } from '../../config/theme';

export default function ConnectionBar() {
  const status = useDeviceStore(s => s.status);
  const openDeviceSheet = () => useDeviceStore.getState().setDeviceSheetOpen(true);

  if (status === 'connected') return null;

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
  text: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
