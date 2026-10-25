import React, { useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import MapView, { PROVIDER_DEFAULT, Region, UrlTile } from 'react-native-maps';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { useCrewStore } from '../../store/useCrewStore';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { getTilePath } from '../../services/map/TilePrefetch';

interface Props {
  visible: boolean;
  initialCoord?: { latitude: number; longitude: number } | null;
  onConfirm: (coord: { latitude: number; longitude: number }) => void;
  onCancel: () => void;
  title?: string;
}

export default function MapPinPicker({ visible, initialCoord, onConfirm, onCancel, title = 'Drop a Pin' }: Props) {
  const mapRef = useRef<MapView>(null);
  const [center, setCenter] = useState<{ latitude: number; longitude: number } | null>(null);

  // Start point, worked out once each time the picker opens. Only on open:
  // callers pass a fresh initialCoord object every render, and re-running on
  // that reset the pin to your GPS position whenever a message arrived, while
  // the map stayed where you'd dragged it, so Confirm sent the wrong spot.
  React.useEffect(() => {
    if (!visible) { setCenter(null); return; }
    const me = useCrewStore.getState().myLocation;
    const venue = festivalConfig.getConfig().venue.center;
    setCenter(initialCoord ?? (me ? { latitude: me.lat, longitude: me.lng } : { latitude: venue.lat, longitude: venue.lng }));
  }, [visible]);

  // Same rule as the Map tab: at the venue, serve tiles from the cache only.
  const venue = festivalConfig.getConfig().venue.center;
  const nearVenue = !!center && Math.abs(center.latitude - venue.lat) < 0.05 && Math.abs(center.longitude - venue.lng) < 0.05;

  const region: Region | null = center && {
    latitude: center.latitude,
    longitude: center.longitude,
    latitudeDelta: 0.006,
    longitudeDelta: 0.006,
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
          <TouchableOpacity onPress={() => center && onConfirm(center)}>
            <Text style={styles.confirmText}>Confirm</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Move the map to place your pin</Text>
        <View style={styles.mapContainer}>
          {/* Mounted once the start point is known, so initialRegion is right
              on every open. */}
          {region && (
            <MapView
              ref={mapRef}
              style={styles.map}
              provider={PROVIDER_DEFAULT}
              mapType="standard"
              initialRegion={region}
              onRegionChangeComplete={handleRegionChangeComplete}
              showsUserLocation
              showsMyLocationButton={false}
              showsCompass={false}
              rotateEnabled={false}
            >
              {/* The venue tiles the Map tab downloaded, so pins aren't
                  dropped onto a blank grid with no signal. */}
              <UrlTile
                urlTemplate="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maximumZ={20}
                maximumNativeZ={18}
                minimumZ={14}
                tileCachePath={getTilePath()}
                offlineMode={nearVenue}
                tileSize={256}
                zIndex={-1}
              />
            </MapView>
          )}

          {/* Fixed center pin overlay */}
          <View style={styles.centerPinWrapper} pointerEvents="none">
            <Text style={styles.centerPinIcon}>📍</Text>
            <View style={styles.centerPinShadow} />
          </View>
        </View>
        <View style={styles.coordBar}>
          <Text style={styles.coordText}>
            {center ? `${center.latitude.toFixed(5)}, ${center.longitude.toFixed(5)}` : ''}
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
