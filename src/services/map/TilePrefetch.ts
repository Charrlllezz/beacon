import { Paths, File, Directory } from 'expo-file-system';

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// Coachella venue bounds with small buffer
const LAT_MIN = 33.673;
const LAT_MAX = 33.687;
const LNG_MIN = -116.247;
const LNG_MAX = -116.229;
const ZOOM_MIN = 14;
const ZOOM_MAX = 18;

function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const y = Math.floor(
    (1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2 * n,
  );
  return { x, y };
}

function getTileDir(): Directory {
  return new Directory(Paths.document, 'tiles');
}

function getMarkerFile(): File {
  return new File(Paths.document, '.tiles-prefetched');
}

export function isTilesPrefetched(): boolean {
  return getMarkerFile().exists;
}

export function getTilePath(): string {
  return getTileDir().uri;
}

export async function prefetchVenueTiles(
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  if (isTilesPrefetched()) return;

  const tileDir = getTileDir();
  if (!tileDir.exists) {
    tileDir.create({ intermediates: true });
  }

  const tiles: { z: number; x: number; y: number }[] = [];

  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
    const topLeft = latLngToTile(LAT_MAX, LNG_MIN, z);
    const bottomRight = latLngToTile(LAT_MIN, LNG_MAX, z);

    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  }

  let downloaded = 0;
  const total = tiles.length;

  // Download in batches of 10
  const batchSize = 10;
  for (let i = 0; i < tiles.length; i += batchSize) {
    const batch = tiles.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async ({ z, x, y }) => {
        const dir = new Directory(tileDir, String(z), String(x));
        if (!dir.exists) {
          dir.create({ intermediates: true });
        }

        const file = new File(dir, `${y}.jpg`);
        if (file.exists) {
          downloaded++;
          onProgress?.(downloaded, total);
          return;
        }

        const url = TILE_URL.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));

        try {
          await File.downloadFileAsync(url, file, { idempotent: true });
        } catch {
          // Non-fatal: tile will load from network if available
        }
        downloaded++;
        onProgress?.(downloaded, total);
      }),
    );
  }

  // Mark prefetch complete
  const marker = getMarkerFile();
  marker.create();
  marker.write(new Date().toISOString());
}
