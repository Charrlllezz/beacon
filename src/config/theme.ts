// Premium utility, warm and social: warm near-black, soft glass surfaces, and
// a sunset accent (orange into pink). Gradient in Gradients.sunset; the flat
// primary is its orange end, for text, borders and small marks.
export const Colors = {
  background: '#0b0a10',
  surface: '#16141c',
  surfaceElevated: '#1f1c27',
  glass: 'rgba(32, 28, 40, 0.62)',
  glassBorder: 'rgba(255, 255, 255, 0.09)',
  primary: '#ff7e4a',
  pink: '#ff4f8b',
  accent: '#ff6a5c',
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#ff5a5f',
  textPrimary: '#f5f2ee',
  textSecondary: '#a39fab',
  textMuted: '#6b6774',
  coordinate: '#7d7889',
  border: 'rgba(255, 255, 255, 0.08)',
  overlay: 'rgba(8, 7, 12, 0.72)',
} as const;

export const Gradients = {
  sunset: ['#ff9a3c', '#ff6a5c', '#ff4f8b'] as const,
  // Soft wash behind the welcome logo.
  dusk: ['rgba(255, 106, 92, 0.18)', 'rgba(255, 79, 139, 0.06)', 'rgba(11, 10, 16, 0)'] as const,
} as const;

// SF Pro Rounded (iOS system font, rounded design) for titles and big numbers;
// SF Pro for body text.
export const Fonts = {
  rounded: 'ui-rounded',
} as const;

// Crew colours: soft pastels that sit beside the sunset accent without
// clashing. Also the fallback for a friend who hasn't sent theirs yet.
export const CREW_PALETTE = [
  '#ffadad', '#ffc6a5', '#ffe29a', '#b9fbc0',
  '#a0e7e5', '#a5c8ff', '#c8b6ff', '#ffb3e6',
] as const;

export function crewColor(nodeId: number, chosen?: string | null): string {
  return chosen ?? CREW_PALETTE[Math.abs(nodeId) % CREW_PALETTE.length];
}

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
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
} as const;

export const Shadow = {
  glow: {
    shadowColor: '#ff6a5c',
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
