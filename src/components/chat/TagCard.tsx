import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { TagMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { useCrewStore } from '../../store/useCrewStore';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { TAG_CATEGORY_ICONS } from '../map/tagCategories';

interface Props {
  message: TagMessage;
  isMine: boolean;
}

/** A spot someone tagged on the map: what and where, not raw coordinates. */
export default function TagCard({ message, isMine }: Props) {
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
          <Text style={styles.emoji} accessible={false}>{TAG_CATEGORY_ICONS[message.category] ?? '📌'}</Text>
          <View style={styles.headerText}>
            <Text style={styles.kicker}>TAGGED A SPOT</Text>
            <Text style={styles.title}>{message.name}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.mapPreview} onPress={openInMaps} accessibilityRole="button">
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
    borderColor: Colors.border,
  },
  sender: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  headerText: { flexShrink: 1 },
  emoji: { fontSize: 28 },
  kicker: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary, marginTop: 2 },
  mapPreview: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 8,
  },
  locationInfo: { flex: 1 },
  nearStage: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '600' },
  distance: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  showMap: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '700' },
  time: { fontSize: FontSize.xs, color: Colors.textMuted, alignSelf: 'flex-end' },
});
