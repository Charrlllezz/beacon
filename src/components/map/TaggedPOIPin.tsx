import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import { Colors, FontSize, BorderRadius } from '../../config/theme';
import type { TaggedPOI, TagCategory } from '../../types/festival';

const CATEGORY_ICONS: Record<TagCategory, string> = {
  stage: '🎵',
  food: '🍔',
  water: '💧',
  restroom: '🚻',
  camp: '⛺',
  custom: '📌',
};

interface Props {
  poi: TaggedPOI;
  onPress?: (poi: TaggedPOI) => void;
}

export default function TaggedPOIPin({ poi, onPress }: Props) {
  const icon = CATEGORY_ICONS[poi.category] || '📌';

  return (
    <Marker
      coordinate={{ latitude: poi.lat, longitude: poi.lng }}
      onPress={() => onPress?.(poi)}
      tracksViewChanges={false}
    >
      <View style={styles.container}>
        <View style={styles.pin}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <Text style={styles.label} numberOfLines={1}>{poi.name}</Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    maxWidth: 80,
  },
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 14 },
  label: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textPrimary,
    backgroundColor: Colors.surface + 'cc',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginTop: 2,
    overflow: 'hidden',
  },
});
