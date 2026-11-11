import React from 'react';
import { SymbolView, type SFSymbol, type AnimationSpec } from 'expo-symbols';
import { Colors } from '../../config/theme';

// SF Symbols, rounded outline; pass `filled` for the selected state (the
// `.fill` variant). Replaces emoji in navigation, buttons and cards.
interface Props {
  name: SFSymbol;
  size?: number;
  color?: string;
  filled?: boolean;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  // Apple's own symbol effects (iOS 17+). They play when the symbol appears
  // or changes, so tie them to a real event: Effects.bounce on selection,
  // Effects.signal while connecting, Effects.pulse while an SOS is live.
  animation?: AnimationSpec;
}

export const Effects = {
  bounce: { effect: { type: 'bounce', wholeSymbol: true } },
  pulse: { effect: { type: 'pulse', wholeSymbol: true }, repeating: true },
  signal: { variableAnimationSpec: { iterative: true, reversing: true, dimInactiveLayers: true }, repeating: true },
} satisfies Record<string, AnimationSpec>;

export default function Icon({ name, size = 22, color = Colors.textPrimary, filled = false, weight = 'medium', animation }: Props) {
  const symbol = (filled && !name.endsWith('.fill') ? `${name}.fill` : name) as SFSymbol;
  return (
    <SymbolView
      name={symbol}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      animationSpec={animation}
      style={{ width: size, height: size }}
    />
  );
}
