import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { SFSymbol } from 'expo-symbols';
import { Colors, Gradients, Fonts, BorderRadius } from '../../config/theme';
import { hapticLight } from '../../utils/haptics';
import Icon from './Icon';

// The app's main call to action: sunset gradient, rounded type, a light
// haptic on press. `variant="ghost"` is the secondary, outlined version.
interface Props {
  label: string;
  onPress: () => void;
  icon?: SFSymbol;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  accessibilityLabel?: string;
}

export default function GradientButton({ label, onPress, icon, variant = 'primary', disabled, style, compact, accessibilityLabel }: Props) {
  const height = compact ? 40 : 54;
  const textColor = variant === 'primary' ? '#fff' : Colors.textPrimary;
  const content = (
    <View style={[styles.row, { height }]}>
      {icon && <Icon name={icon} size={compact ? 16 : 19} color={textColor} weight="semibold" />}
      <Text style={[styles.label, compact && styles.labelCompact, { color: textColor }]}>{label}</Text>
    </View>
  );
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.base,
        { borderRadius: height / 2, opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        variant === 'ghost' && styles.ghost,
        style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={Gradients.sunset} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[StyleSheet.absoluteFill, { borderRadius: height / 2 }]} />
      ) : null}
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
  },
  ghost: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    shadowOpacity: 0,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 22 },
  label: { fontFamily: Fonts.rounded, fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  labelCompact: { fontSize: 14 },
});
