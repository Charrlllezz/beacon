import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius, Fonts } from '../../config/theme';
import type { RallyMessage } from '../../types/messages';
import { timeAgo } from '../../utils/time';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { useNavigation } from '@react-navigation/native';
import { useCrewStore } from '../../store/useCrewStore';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { glassCard } from '../ui/Glass';
import CardIcon from './CardIcon';
import ReplyBar from './ReplyBar';
import { useSenderColor } from './useSenderColor';

const RALLY_ANSWERABLE_MS = 3 * 3600 * 1000;

interface Props {
  message: RallyMessage;
  isMine: boolean;
}

export default function RallyCard({ message, isMine }: Props) {
  const myLocation = useCrewStore(s => s.myLocation);
  const senderColor = useSenderColor(message.fromNodeId);

  const distance = myLocation
    ? haversineDistance(myLocation.lat, myLocation.lng, message.lat, message.lng)
    : null;

  const nearestStage = festivalConfig.getNearestStage(message.lat, message.lng);

  const navigation = useNavigation();
  const openInMaps = () => {
    useCrewStore.getState().setFocusPoint({ lat: message.lat, lng: message.lng, kind: 'rally', label: message.note ?? 'Rally Point' });
    (navigation as any).navigate('Map');
  };

  return (
    <View style={[styles.row, isMine && styles.rowMine]}>
      <View style={styles.card}>
        {!isMine && <Text style={[styles.sender, { color: senderColor }]}>{message.fromName}</Text>}
        <View style={styles.header}>
          <CardIcon name="mappin.and.ellipse" sunset />
          <View style={styles.headerText}>
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
        {/* A rally point from hours ago isn't one to answer any more. */}
        <ReplyBar message={message} isMine={isMine} options={Date.now() - message.timestamp < RALLY_ANSWERABLE_MS ? ['omw', 'cant'] : []} />
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
  title: { fontFamily: Fonts.rounded, fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary },
  note: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
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
