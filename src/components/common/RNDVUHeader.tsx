import React from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Colors, FontSize, Spacing, Fonts } from '../../config/theme';
import Icon from '../ui/Icon';
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
          <Icon name="gearshape" size={20} color={Colors.textSecondary} />
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
    paddingTop: Spacing.sm,
    paddingBottom: 4,
    backgroundColor: Colors.background,
    gap: 8,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: FontSize.xxl,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: Fonts.rounded,
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
  statusDot: { width: 7, height: 7, borderRadius: 4 },
});
