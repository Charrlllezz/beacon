import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { RallyMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { useCrewStore } from '../../store/useCrewStore';
import { festivalConfig } from '../../services/festival/FestivalConfig';

interface Props {
  message: RallyMessage;
  isMine: boolean;
}

export default function RallyCard({ message, isMine }: Props) {
  const myLocation = useCrewStore(s => s.myLocation);

  const distance = myLocation
    ? haversineDistance(myLocation.lat, myLocation.lng, message.lat, message.lng)
    : null;

  const nearestStage = festivalConfig.getNearestStage(message.lat, message.lng);

  const openInMaps = () => {
    const url = Platform.select({
      ios: `maps:?daddr=${message.lat},${message.lng}`,
      default: `geo:${message.lat},${message.lng}?q=${message.lat},${message.lng}`,
    });
    Linking.openURL(url);
  };

  return (
    <View style={[styles.row, isMine && styles.rowMine]}>
      <View style={styles.card}>
        {!isMine && <Text style={styles.sender}>{message.fromName}</Text>}
        <View style={styles.header}>
          <Text style={styles.emoji}>📍</Text>
          <View>
            <Text style={styles.title}>Rally Point</Text>
            {message.note && <Text style={styles.note}>{message.note}</Text>}
          </View>
        </View>
        <TouchableOpacity style={styles.mapPreview} onPress={openInMaps}>
          <View style={styles.locationInfo}>
            {nearestStage && (
              <Text style={styles.nearStage}>Near {nearestStage.shortName}</Text>
            )}
            {distance !== null && (
              <Text style={styles.distance}>{formatDistance(distance)} away</Text>
            )}
          </View>
          <Text style={styles.showMap}>Open Map →</Text>
        </TouchableOpacity>
        <Text style={styles.time}>{timeAgo(message.timestamp / 1000)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginVertical: 4, alignItems: 'flex-start' },
  rowMine: { alignItems: 'flex-end' },
  card: {
    maxWidth: '82%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: '#1e1d2a',
  },
  sender: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  emoji: { fontSize: 28 },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  note: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  mapPreview: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  locationInfo: { flex: 1 },
  nearStage: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '600' },
  distance: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  showMap: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '700' },
  time: { fontSize: FontSize.xs, color: Colors.textMuted, alignSelf: 'flex-end' },
});
