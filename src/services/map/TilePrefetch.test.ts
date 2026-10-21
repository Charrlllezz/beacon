import { describe, test, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the slice of expo-file-system TilePrefetch uses.
const fs = vi.hoisted(() => {
  const paths = new Set<string>();
  const state = { failUrl: (_url: string) => false, downloads: 0 };
  const join = (base: any, names: string[]) => [typeof base === 'string' ? base : base.uri, ...names].join('/');
  class Directory {
    uri: string;
    constructor(base: any, ...names: string[]) { this.uri = join(base, names); }
    get exists() { return paths.has(this.uri); }
    create() { paths.add(this.uri); }
  }
  class File {
    uri: string;
    constructor(base: any, ...names: string[]) { this.uri = join(base, names); }
    get exists() { return paths.has(this.uri); }
    create() { paths.add(this.uri); }
    write() {}
    static async downloadFileAsync(url: string, file: File) {
      state.downloads++;
      if (state.failUrl(url)) throw new Error('network');
      paths.add(file.uri);
    }
  }
  return { paths, state, Directory, File, Paths: { document: 'doc' } };
});
vi.mock('expo-file-system', () => ({ Directory: fs.Directory, File: fs.File, Paths: fs.Paths }));

import { prefetchVenueTiles, isTilesPrefetched } from './TilePrefetch';
import { tilesForBounds } from './tileMath';

// Small area so tests run fast: a few dozen tiles across z14-18.
const BOUNDS = { ne: { lat: 34.0880, lng: -117.2910 }, sw: { lat: 34.0860, lng: -117.2930 } };
const TOTAL = tilesForBounds(BOUNDS).length;

describe('prefetchVenueTiles', () => {
  beforeEach(() => {
    fs.paths.clear();
    fs.state.downloads = 0;
    fs.state.failUrl = () => false;
  });

  test('all tiles download: complete, marker written', async () => {
    expect(TOTAL).toBeGreaterThan(10);
    const r = await prefetchVenueTiles(BOUNDS);
    expect(r).toEqual({ total: TOTAL, failed: 0, aborted: false });
    expect(isTilesPrefetched(BOUNDS)).toBe(true);
    // Complete: a second call downloads nothing.
    fs.state.downloads = 0;
    await prefetchVenueTiles(BOUNDS);
    expect(fs.state.downloads).toBe(0);
  });

  test('some failures: no marker, and the retry fetches only what is missing', async () => {
    fs.state.failUrl = (url) => url.includes('/tile/18/');
    const r = await prefetchVenueTiles(BOUNDS);
    const z18 = tilesForBounds(BOUNDS, 18, 18).length;
    expect(r.failed).toBe(z18);
    expect(isTilesPrefetched(BOUNDS)).toBe(false);

    fs.state.failUrl = () => false;
    fs.state.downloads = 0;
    const again = await prefetchVenueTiles(BOUNDS);
    expect(again.failed).toBe(0);
    expect(fs.state.downloads).toBe(z18);
    expect(isTilesPrefetched(BOUNDS)).toBe(true);
  });

  test('no network: stops after one failed batch instead of trying every tile', async () => {
    fs.state.failUrl = () => true;
    const r = await prefetchVenueTiles(BOUNDS);
    expect(r.aborted).toBe(true);
    expect(r.failed).toBe(TOTAL);
    expect(fs.state.downloads).toBe(10);
  });
});
