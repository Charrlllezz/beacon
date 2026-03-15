import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useDeviceStore } from '../../store/useDeviceStore';
import { Colors, FontSize } from '../../config/theme';

export default function ConnectionBar() {
  const status = useDeviceStore(s => s.status);

  if (status === 'connected') return null;

  const config: Record<string, { label: string; color: string }> = {
    disconnected: { label: 'DISCONNECTED — last known data shown', color: Colors.error },
    scanning:     { label: 'SCANNING FOR DEVICE…', color: Colors.warning },
    connecting:   { label: 'CONNECTING TO MESH…', color: Colors.warning },
    reconnecting: { label: 'RECONNECTING…', color: Colors.warning },
  };

  const { label, color } = config[status] ?? config.disconnected;

  return (
    <View style={[styles.bar, { backgroundColor: color + '22', borderBottomColor: color + '44' }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  text: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
