import type { GeoBounds } from '../../types/festival';

export const TILE_ZOOM_MIN = 14;
export const TILE_ZOOM_MAX = 18;

export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const y = Math.floor(
    (1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2 * n,
  );
  return { x, y };
}

/** Every slippy-map tile covering `bounds` at zooms min..max. */
export function tilesForBounds(
  bounds: GeoBounds,
  zMin = TILE_ZOOM_MIN,
  zMax = TILE_ZOOM_MAX,
): { z: number; x: number; y: number }[] {
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let z = zMin; z <= zMax; z++) {
    const topLeft = latLngToTile(bounds.ne.lat, bounds.sw.lng, z);
    const bottomRight = latLngToTile(bounds.sw.lat, bounds.ne.lng, z);
    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/**
 * Stable short key for a tile area, used to name its "fully prefetched"
 * marker. Tiles themselves are shared across areas ({z}/{x}/{y} is global), so
 * switching festivals only downloads what the new area is missing.
 */
export function boundsKey(bounds: GeoBounds): string {
  const r = (n: number) => n.toFixed(3);
  return `${r(bounds.sw.lat)}_${r(bounds.sw.lng)}_${r(bounds.ne.lat)}_${r(bounds.ne.lng)}`;
}
