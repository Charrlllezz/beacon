export const Colors = {
  background: '#06060b',
  surface: '#0d0d18',
  surfaceElevated: '#13131f',
  primary: '#ff8c42',
  accent: '#ff6b35',
  success: '#00e676',
  warning: '#ffd740',
  error: '#ff5252',
  textPrimary: '#f2f0ed',
  textSecondary: '#7a7680',
  textMuted: '#3d3a45',
  coordinate: '#5a5470',
  border: '#1e1d2a',
  overlay: 'rgba(6, 6, 11, 0.85)',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  hero: 36,
} as const;

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const Shadow = {
  glow: {
    shadowColor: '#ff8c42',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;
