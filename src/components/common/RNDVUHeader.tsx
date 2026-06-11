import React from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Colors, FontSize, Spacing } from '../../config/theme';
import { useDeviceStore } from '../../store/useDeviceStore';

interface Props {
  title: string;
  subtitle?: string;
  onLongPress?: () => void;
}

export default function RNDVUHeader({ title, subtitle, onLongPress }: Props) {
  const status = useDeviceStore(s => s.status);
  const openDeviceSheet = () => useDeviceStore.getState().setDeviceSheetOpen(true);

  // The gear's dot doubles as an at-a-glance connection light:
  // green = connected, amber = connecting/reconnecting/scanning, red = disconnected.
  const dotColor =
    status === 'connected' ? Colors.success
    : status === 'disconnected' ? Colors.error
    : Colors.warning;

  return (
    <Pressable onLongPress={onLongPress} delayLongPress={1500}>
      <View style={styles.container}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        <TouchableOpacity
          style={styles.gear}
          onPress={openDeviceSheet}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Device and connection settings"
        >
          <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
          <Text style={styles.gearIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1d2a',
    backgroundColor: Colors.background,
    gap: 8,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  gear: {
    marginLeft: 'auto',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: Spacing.sm,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  gearIcon: { fontSize: 18 },
});
