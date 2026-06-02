import React, { useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import MapView, { PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { useCrewStore } from '../../store/useCrewStore';

interface Props {
  visible: boolean;
  initialCoord?: { latitude: number; longitude: number } | null;
  onConfirm: (coord: { latitude: number; longitude: number }) => void;
  onCancel: () => void;
  title?: string;
}

export default function MapPinPicker({ visible, initialCoord, onConfirm, onCancel, title = 'Drop a Pin' }: Props) {
  const mapRef = useRef<MapView>(null);
  const myLocation = useCrewStore(s => s.myLocation);
  const fallback = myLocation
    ? { latitude: myLocation.lat, longitude: myLocation.lng }
    : { latitude: 33.6803, longitude: -116.2378 };
  const [center, setCenter] = useState<{ latitude: number; longitude: number }>(
    initialCoord ?? fallback
  );

  // Reset pin when modal opens with new initial coord
  React.useEffect(() => {
    if (visible && initialCoord) {
      setCenter(initialCoord);
    } else if (visible) {
      setCenter(myLocation ? { latitude: myLocation.lat, longitude: myLocation.lng } : fallback);
    }
  }, [visible, initialCoord]);

  const region: Region = {
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
            mapType="standard"
            initialRegion={region}
            onRegionChangeComplete={handleRegionChangeComplete}
            showsUserLocation
            showsMyLocationButton={false}
            showsCompass={false}
            rotateEnabled={false}
          />

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
