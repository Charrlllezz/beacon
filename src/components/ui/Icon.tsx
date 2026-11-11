import React from 'react';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Colors } from '../../config/theme';

// SF Symbols, rounded outline; pass `filled` for the selected state (the
// `.fill` variant). Replaces emoji in navigation, buttons and cards.
interface Props {
  name: SFSymbol;
  size?: number;
  color?: string;
  filled?: boolean;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}

export default function Icon({ name, size = 22, color = Colors.textPrimary, filled = false, weight = 'medium' }: Props) {
  const symbol = (filled && !name.endsWith('.fill') ? `${name}.fill` : name) as SFSymbol;
  return (
    <SymbolView
      name={symbol}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
    />
  );
}
