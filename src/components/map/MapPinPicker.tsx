import React, { useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { useTagStore } from '../../store/useTagStore';
import TaggedPOIPin from './TaggedPOIPin';

const config = festivalConfig.getConfig();

interface Props {
  visible: boolean;
  initialCoord?: { latitude: number; longitude: number } | null;
  onConfirm: (coord: { latitude: number; longitude: number }) => void;
  onCancel: () => void;
  title?: string;
}

export default function MapPinPicker({ visible, initialCoord, onConfirm, onCancel, title = 'Drop a Pin' }: Props) {
  const mapRef = useRef<MapView>(null);
  const [center, setCenter] = useState<{ latitude: number; longitude: number }>(
    initialCoord ?? { latitude: config.venue.center.lat, longitude: config.venue.center.lng }
  );
  const tags = useTagStore(s => s.tags);

  // Reset pin when modal opens with new initial coord
  React.useEffect(() => {
    if (visible && initialCoord) {
      setCenter(initialCoord);
    } else if (visible) {
      setCenter({ latitude: config.venue.center.lat, longitude: config.venue.center.lng });
    }
  }, [visible, initialCoord]);

  const region: Region = {
    latitude: center.latitude,
    longitude: center.longitude,
    latitudeDelta: Math.abs(config.venue.bounds.ne.lat - config.venue.bounds.sw.lat) * 1.2,
    longitudeDelta: Math.abs(config.venue.bounds.ne.lng - config.venue.bounds.sw.lng) * 1.2,
  };

  const handleRegionChangeComplete = useCallback((r: Region) => {
    setCenter({ latitude: r.latitude, longitude: r.longitude });
  }, []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={() => onConfirm(center)}>
            <Text style={styles.confirmText}>Confirm</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Move the map to place your pin</Text>
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={PROVIDER_DEFAULT}
            mapType="satellite"
            initialRegion={region}
            onRegionChangeComplete={handleRegionChangeComplete}
            showsUserLocation
            showsMyLocationButton={false}
            showsCompass={false}
            rotateEnabled={false}
          >
            {/* Stage markers */}
            {config.stages.map(stage => (
              <Marker
                key={stage.id}
                coordinate={{ latitude: stage.location.lat, longitude: stage.location.lng }}
                tracksViewChanges={false}
              >
                <View style={styles.stagePin}>
                  <View style={[styles.stageDot, { backgroundColor: stage.color }]} />
                  <Text style={[styles.stageName, { color: stage.color }]}>{stage.shortName}</Text>
                </View>
              </Marker>
            ))}

            {/* Community-tagged POIs */}
            {tags.map(tag => (
              <TaggedPOIPin key={tag.id} poi={tag} />
            ))}
          </MapView>

          {/* Fixed center pin overlay */}
          <View style={styles.centerPinWrapper} pointerEvents="none">
            <Text style={styles.centerPinIcon}>📍</Text>
            <View style={styles.centerPinShadow} />
          </View>
        </View>
        <View style={styles.coordBar}>
          <Text style={styles.coordText}>
            {center.latitude.toFixed(5)}, {center.longitude.toFixed(5)}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: 56,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  title: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  confirmText: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  hint: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceElevated,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  stagePin: {
    alignItems: 'center',
    maxWidth: 90,
  },
  stageDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 2,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.3)',
  },
  stageName: {
    fontSize: 10,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  centerPinWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPinIcon: {
    fontSize: 40,
    marginTop: -40,
  },
  centerPinShadow: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.3)',
    marginTop: -4,
  },
  coordBar: {
    backgroundColor: Colors.surfaceElevated,
    padding: Spacing.md,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: 34,
  },
  coordText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontFamily: 'monospace',
  },
});
