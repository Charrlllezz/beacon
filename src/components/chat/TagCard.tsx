import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import { Colors, Spacing, FontSize, BorderRadius, Fonts } from '../../config/theme';
import type { TagMessage } from '../../types/messages';
import type { TagCategory } from '../../types/festival';
import { timeAgo } from '../../utils/time';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { useCrewStore } from '../../store/useCrewStore';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { glassCard } from '../ui/Glass';
import CardIcon from './CardIcon';
import { useSenderColor } from './useSenderColor';

interface Props {
  message: TagMessage;
  isMine: boolean;
}

const CATEGORY_SYMBOLS: Record<TagCategory, { name: SFSymbol; color: string }> = {
  stage:    { name: 'music.mic',  color: '#c8b6ff' },
  food:     { name: 'fork.knife', color: '#ffc6a5' },
  water:    { name: 'drop.fill',  color: '#a0e7e5' },
  restroom: { name: 'toilet',     color: '#a5c8ff' },
  camp:     { name: 'tent',       color: '#b9fbc0' },
  custom:   { name: 'mappin',     color: Colors.primary },
};

/** A spot someone tagged on the map: what and where, not raw coordinates. */
export default function TagCard({ message, isMine }: Props) {
  const myLocation = useCrewStore(s => s.myLocation);
  const senderColor = useSenderColor(message.fromNodeId);
  const symbol = CATEGORY_SYMBOLS[message.category] ?? CATEGORY_SYMBOLS.custom;

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
        {!isMine && <Text style={[styles.sender, { color: senderColor }]}>{message.fromName}</Text>}
        <View style={styles.header}>
          <CardIcon name={symbol.name} color={symbol.color} />
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
    ...glassCard,
    maxWidth: '84%',
    padding: 14,
  },
  sender: {
    fontFamily: Fonts.rounded,
    fontSize: FontSize.xs,
    fontWeight: '700',
    marginBottom: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  headerText: { flexShrink: 1 },
  kicker: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.6 },
  title: { fontFamily: Fonts.rounded, fontSize: FontSize.md, fontWeight: '800', color: Colors.textPrimary, marginTop: 2 },
  mapPreview: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: BorderRadius.md,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 8,
  },
  locationInfo: { flex: 1 },
  nearStage: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '600' },
  distance: { fontFamily: Fonts.rounded, fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, fontVariant: ['tabular-nums'] },
  showMap: { fontFamily: Fonts.rounded, fontSize: FontSize.xs, color: Colors.primary, fontWeight: '700' },
  time: { fontSize: FontSize.xs, color: Colors.textMuted, alignSelf: 'flex-end' },
});
