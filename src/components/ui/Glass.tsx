import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Colors, BorderRadius } from '../../config/theme';

// Soft glass surface: blurred, translucent warm dark, faint light border.
// Use over the map and for floating bars and sheets; plain lists can use the
// flat `glassCard` style below (no blur needed over a solid background).
interface Props {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  radius?: number;
}

export default function Glass({ children, style, intensity = 40, radius = BorderRadius.lg }: Props) {
  return (
    <View style={[styles.wrap, { borderRadius: radius }, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.glass }]} />
      {children}
    </View>
  );
}

export const glassCard: ViewStyle = {
  backgroundColor: 'rgba(255, 255, 255, 0.045)',
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: Colors.glassBorder,
  borderRadius: BorderRadius.lg,
};

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
});
