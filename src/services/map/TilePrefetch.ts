import { Paths, File, Directory } from 'expo-file-system';
import type { GeoBounds } from '../../types/festival';
import { tilesForBounds, boundsKey } from './tileMath';

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

function getTileDir(): Directory {
  return new Directory(Paths.document, 'tiles');
}

function getMarkerFile(bounds: GeoBounds): File {
  // Versioned: v2 when the on-disk tile filename changed from "{y}.jpg" to
  // "{y}" (no extension), so stale installs re-download. One marker per area:
  // the area now comes from the active festival config (venue.tileBounds).
  return new File(Paths.document, `.tiles-prefetched-v2-${boundsKey(bounds)}`);
}

export function isTilesPrefetched(bounds: GeoBounds): boolean {
  return getMarkerFile(bounds).exists;
}

export function getTilePath(): string {
  return getTileDir().uri;
}

export interface PrefetchResult {
  total: number;
  failed: number;
  // Stopped early: a whole batch failed, which means no network (e.g. already
  // at the venue). The rest weren't attempted; the next foreground retries.
  aborted: boolean;
}

export async function prefetchVenueTiles(
  bounds: GeoBounds,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<PrefetchResult> {
  const tiles = tilesForBounds(bounds);
  const total = tiles.length;
  if (isTilesPrefetched(bounds)) return { total, failed: 0, aborted: false };

  const tileDir = getTileDir();
  if (!tileDir.exists) {
    tileDir.create({ intermediates: true });
  }

  let downloaded = 0;
  let failed = 0;

  // Download in batches of 10
  const batchSize = 10;
  for (let i = 0; i < tiles.length; i += batchSize) {
    const batch = tiles.slice(i, i + batchSize);
    const failedBefore = failed;
    let attempted = 0;
    await Promise.all(
      batch.map(async ({ z, x, y }) => {
        const dir = new Directory(tileDir, String(z), String(x));
        try {
          if (!dir.exists) dir.create({ intermediates: true });
        } catch {
          // A concurrent task in this batch may have created it first — fine.
        }

        // IMPORTANT: no file extension. react-native-maps' native cached
        // overlay reads tiles at <tileCachePath>/{z}/{x}/{y} with NO suffix
        // (AIRMapUrlTileCachedOverlay.m getTileImage). Writing "${y}.jpg" made
        // every prefetched tile invisible and the map silently fell back to
        // the network — useless at a no-signal venue.
        const file = new File(dir, String(y));
        if (file.exists) {
          downloaded++;
          onProgress?.(downloaded, total);
          return;
        }

        const url = TILE_URL.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));

        attempted++;
        try {
          await File.downloadFileAsync(url, file, { idempotent: true });
        } catch {
          // Non-fatal for this run: the tile loads from network if available,
          // and we withhold the completion marker so the next launch retries
          // just the missing tiles (existing ones are skipped above).
          failed++;
        }
        downloaded++;
        onProgress?.(downloaded, total);
      }),
    );
    // Every download in this batch failed: no network. Stop instead of
    // grinding through the rest; count them as missing.
    if (attempted === batchSize && failed - failedBefore === attempted) {
      return { total, failed: total - (downloaded - failed), aborted: true };
    }
  }

  // Only mark prefetch complete when EVERY tile is on disk. Writing the marker
  // after a partial/failed pass permanently poisoned the cache state, because
  // isTilesPrefetched() short-circuits all future prefetch attempts.
  if (failed === 0) {
    const marker = getMarkerFile(bounds);
    marker.create();
    marker.write(new Date().toISOString());
  }
  return { total, failed, aborted: false };
}
