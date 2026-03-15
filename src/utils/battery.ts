import { Colors } from '../config/theme';

export function batteryColor(level?: number): string {
  if (level === undefined) return Colors.textMuted;
  if (level <= 10) return Colors.error;
  if (level <= 25) return Colors.warning;
  return Colors.success;
}

export function batteryIcon(level?: number): string {
  if (level === undefined) return '🔋';
  if (level <= 10) return '🪫';
  if (level <= 25) return '🔋';
  return '🔋';
}

export function batteryLabel(level?: number): string {
  if (level === undefined) return '--';
  return `${level}%`;
}
