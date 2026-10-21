import qrcode from 'qrcode-generator';

/**
 * QR modules for `text` (true = dark), smallest version that fits, error
 * correction M (survives a scuffed screen or glare). Pure JS: no native
 * module or SVG needed to show it.
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** A row as runs of [dark, length], so it renders as a few Views, not one per module. */
export function rowRuns(row: boolean[]): [boolean, number][] {
  const runs: [boolean, number][] = [];
  for (const dark of row) {
    const last = runs[runs.length - 1];
    if (last && last[0] === dark) last[1]++;
    else runs.push([dark, 1]);
  }
  return runs;
}
