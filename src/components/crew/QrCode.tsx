import React, { useMemo } from 'react';
import { View } from 'react-native';
import { qrMatrix, rowRuns } from '../../utils/qrMatrix';

/** Black on white with a quiet zone, sized to `size` points. */
export default function QrCode({ value, size }: { value: string; size: number }) {
  const matrix = useMemo(() => qrMatrix(value), [value]);
  const quiet = 4; // modules of white border scanners expect
  const cell = size / (matrix.length + quiet * 2);
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff', padding: cell * quiet }}>
      {matrix.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', height: cell }}>
          {rowRuns(row).map(([dark, len], i) => (
            <View key={i} style={{ width: cell * len, height: cell, backgroundColor: dark ? '#000' : '#fff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}
