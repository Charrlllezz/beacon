import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { SFSymbol } from 'expo-symbols';
import { Gradients } from '../../config/theme';
import Icon from '../ui/Icon';

/**
 * The rounded tile that leads a chat card: a sunset gradient for the crew's
 * plans (rally, meetup), or a soft tint of `color` for everything else.
 */
export default function CardIcon({ name, color, sunset }: { name: SFSymbol; color?: string; sunset?: boolean }) {
  if (sunset) {
    return (
      <LinearGradient colors={Gradients.sunset} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
        <Icon name={name} size={20} color="#fff" weight="semibold" />
      </LinearGradient>
    );
  }
  return (
    <View style={[styles.tile, { backgroundColor: (color ?? '#ffffff') + '24' }]}>
      <Icon name={name} size={20} color={color} weight="semibold" />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
