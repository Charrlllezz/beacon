export function latLngFromI(latI: number, lngI: number): { lat: number; lng: number } {
  return { lat: latI / 1e7, lng: lngI / 1e7 };
}

export function latLngToI(lat: number, lng: number): { latI: number; lngI: number } {
  return { latI: Math.round(lat * 1e7), lngI: Math.round(lng * 1e7) };
}

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function formatGps(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Map image dimensions (lib-2026-map.png)
export const MAP_IMG_W = 2500;
export const MAP_IMG_H = 992;

// Affine transform coefficients from 10-point least-squares calibration
// Maps GPS coordinates <-> raw image pixels (before display scaling)
const al = 5.087868642501e-08, bl = -1.007694799215e-05, cl = 35.234886966476;
const ag = 1.211152715086e-05, bg = 7.880214069799e-08, cg = -119.281631594995;
const det = al * bg - ag * bl;

/** GPS → raw image pixel (unscaled). Returns null if out of bounds. */
export function gpsToMapPixel(lat: number, lng: number): { x: number; y: number } | null {
  const px = (bg * (lat - cl) - bl * (lng - cg)) / det;
  const py = (al * (lng - cg) - ag * (lat - cl)) / det;
  if (px < -50 || px > MAP_IMG_W + 50 || py < -50 || py > MAP_IMG_H + 50) return null;
  return { x: px, y: py };
}

/** Raw image pixel → GPS. */
export function mapPixelToGps(px: number, py: number): { lat: number; lng: number } {
  return { lat: al * px + bl * py + cl, lng: ag * px + bg * py + cg };
}
