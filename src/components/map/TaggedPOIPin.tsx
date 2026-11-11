import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import { Colors, FontSize, BorderRadius, Fonts } from '../../config/theme';
import Icon from '../ui/Icon';
import type { TaggedPOI } from '../../types/festival';
import { TAG_CATEGORY_ICONS as CATEGORY_ICONS } from './tagCategories';

interface Props {
  poi: TaggedPOI;
  onPress?: (poi: TaggedPOI) => void;
}

export default function TaggedPOIPin({ poi, onPress }: Props) {
  const icon = CATEGORY_ICONS[poi.category] ?? 'mappin';

  return (
    <Marker
      coordinate={{ latitude: poi.lat, longitude: poi.lng }}
      onPress={() => onPress?.(poi)}
      tracksViewChanges={false}
    >
      <View style={styles.container}>
        <View style={styles.pin}>
          <Icon name={icon} size={14} color={Colors.primary} weight="semibold" />
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
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  label: {
    fontFamily: Fonts.rounded,
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textPrimary,
    backgroundColor: 'rgba(11, 10, 16, 0.78)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 2,
    overflow: 'hidden',
  },
});
