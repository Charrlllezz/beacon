import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import { bleService } from '../../services/ble/BleManager';
import { routeFromRadio } from '../../services/ble/PacketRouter';
import { Colors, FontSize } from '../../config/theme';

export default function ConnectionBar() {
  const status = useDeviceStore(s => s.status);
  const connectedDeviceId = useDeviceStore(s => s.connectedDeviceId);

  const handleReconnect = useCallback(async () => {
    const lastDevice = await useDeviceStore.getState().loadLastDevice();
    const deviceId = connectedDeviceId ?? lastDevice?.id;
    if (!deviceId) return;

    useDeviceStore.getState().setStatus('reconnecting');

    const unsub = bleService.onPacket((fromRadio) => {
      const myNodeNum = useDeviceStore.getState().myNodeNum;
      routeFromRadio(fromRadio, myNodeNum);
    });

    const unsubStatus = bleService.onStatus((s) => {
      useDeviceStore.getState().setStatus(s === 'connected' ? 'connected' : 'disconnected');
    });

    try {
      await bleService.connect(deviceId);
      useDeviceStore.getState().setStatus('connected');
    } catch {
      useDeviceStore.getState().setStatus('disconnected');
      unsub();
      unsubStatus();
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
      style={[styles.bar, { backgroundColor: color + '22', borderBottomColor: color + '44' }]}
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
    paddingVertical: 6,
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
