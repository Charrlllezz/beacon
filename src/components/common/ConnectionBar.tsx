import React, { useCallback } from 'react';
import { Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useDeviceStore } from '../../store/useDeviceStore';
import { bleService } from '../../services/ble/BleManager';
import { Colors, FontSize } from '../../config/theme';

export default function ConnectionBar() {
  const status = useDeviceStore(s => s.status);
  const connectedDeviceId = useDeviceStore(s => s.connectedDeviceId);

  const handleReconnect = useCallback(async () => {
    const lastDevice = await useDeviceStore.getState().loadLastDevice();
    const deviceId = connectedDeviceId ?? lastDevice?.id;
    if (!deviceId) return;

    // Clear any orphan native state / pending auto-reconnect timers before
    // reconnecting, so connectToDevice doesn't race with the internal retry loop.
    // disconnect() emits 'disconnected' via onStatus, so we set 'reconnecting'
    // AFTER it to avoid the state being clobbered.
    bleService.disconnect();
    useDeviceStore.getState().setStatus('reconnecting');

    try {
      await bleService.connect(deviceId);
      // connect() emits 'connected' via onStatus on success; no need to set here
    } catch {
      useDeviceStore.getState().setStatus('disconnected');
    }
  }, [connectedDeviceId]);

  if (status === 'connected') return null;

  const isActive = status === 'scanning' || status === 'connecting' || status === 'reconnecting';

  const config: Record<string, { label: string; color: string }> = {
    disconnected: { label: 'DISCONNECTED', color: Colors.error },
    scanning:     { label: 'SCANNING FOR DEVICE…', color: Colors.warning },
    connecting:   { label: 'CONNECTING…', color: Colors.warning },
    reconnecting: { label: 'RECONNECTING…', color: Colors.warning },
  };

  const { label, color } = config[status] ?? config.disconnected;

  return (
    <TouchableOpacity
      style={[
        styles.bar,
        {
          backgroundColor: color + (status === 'disconnected' ? '44' : '22'),
          borderBottomColor: color + (status === 'disconnected' ? '88' : '44'),
        },
      ]}
      onPress={status === 'disconnected' ? handleReconnect : undefined}
      activeOpacity={status === 'disconnected' ? 0.7 : 1}
    >
      {isActive && (
        <ActivityIndicator size="small" color={color} style={styles.spinner} />
      )}
      <Text style={[styles.text, { color }]}>
        {label}
        {status === 'disconnected' && ' — Tap to reconnect'}
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
