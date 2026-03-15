import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '../config/theme';
import { festivalConfig } from '../services/festival/FestivalConfig';
import { useCrewStore } from '../store/useCrewStore';
import { useMapCalibrationStore } from '../store/useMapCalibrationStore';
import { buildCalibrationMessage } from '../services/mesh/MessageService';
import { bleService } from '../services/ble/BleManager';
import type { GpsPoint } from '../types/festival';

interface CalibrationPoint {
  imageX: number; // normalized 0–1
  imageY: number; // normalized 0–1
  gps: GpsPoint;
}

interface Props {
  onClose: () => void;
}

const MIN_SEPARATION = 0.05; // minimum normalized image distance between 2 points

const config = festivalConfig.getConfig();
const mapOverlay = config.venue.mapOverlay;

function computeAnchors(a: CalibrationPoint, b: CalibrationPoint) {
  const latRange = (b.gps.lat - a.gps.lat) / (b.imageY - a.imageY);
  const lngRange = (b.gps.lng - a.gps.lng) / (b.imageX - a.imageX);
  const topLeft: GpsPoint = {
    lat: a.gps.lat - a.imageY * latRange,
    lng: a.gps.lng - a.imageX * lngRange,
  };
  const bottomRight: GpsPoint = {
    lat: topLeft.lat + latRange,
    lng: topLeft.lng + lngRange,
  };
  return { topLeft, bottomRight };
}

export default function MapCalibrationScreen({ onClose }: Props) {
  const [imageLayout, setImageLayout] = useState<{ width: number; height: number } | null>(null);
  const [points, setPoints] = useState<CalibrationPoint[]>([]);
  const [applying, setApplying] = useState(false);
  const myLocation = useCrewStore(s => s.myLocation);
  const setAnchors = useMapCalibrationStore(s => s.setAnchors);
  const clearAnchors = useMapCalibrationStore(s => s.clearAnchors);

  const handleImageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setImageLayout({ width, height });
  }, []);

  const handleImageTap = useCallback((e: GestureResponderEvent) => {
    if (!imageLayout || points.length >= 2) return;

    if (!myLocation) {
      Alert.alert('No GPS fix', 'Waiting for a position packet from your Beacon device. Make sure it has a GPS lock.');
      return;
    }

    const { locationX, locationY } = e.nativeEvent;
    const ix = locationX / imageLayout.width;
    const iy = locationY / imageLayout.height;
    setPoints(prev => [...prev, { imageX: ix, imageY: iy, gps: { ...myLocation } }]);
  }, [imageLayout, points.length, myLocation]);

  const pointsSeparated = points.length === 2 && (() => {
    const dx = points[1].imageX - points[0].imageX;
    const dy = points[1].imageY - points[0].imageY;
    return Math.sqrt(dx * dx + dy * dy) >= MIN_SEPARATION;
  })();

  const handleApply = useCallback(async () => {
    if (!pointsSeparated) return;
    setApplying(true);
    try {
      const anchors = computeAnchors(points[0], points[1]);
      setAnchors(anchors);
      try {
        await bleService.sendText(buildCalibrationMessage(anchors));
      } catch {
        // best-effort broadcast; calibration is saved locally regardless
      }
      onClose();
    } catch {
      Alert.alert('Calibration failed', 'Could not compute anchors. Try again with more separated points.');
    } finally {
      setApplying(false);
    }
  }, [points, pointsSeparated, setAnchors, onClose]);

  const handleReset = useCallback(() => setPoints([]), []);

  const handleClearCalibration = useCallback(() => {
    Alert.alert(
      'Clear calibration?',
      'Map overlay will revert to config placeholder anchors.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => { clearAnchors(); onClose(); } },
      ],
    );
  }, [clearAnchors, onClose]);

  const step = points.length === 0 ? 1 : points.length === 1 ? 2 : 3;

  const instructions = [
    'Walk to any spot you can identify on this map.\nTap that spot on the image.',
    'Now walk to a DIFFERENT identifiable spot.\nTap it on the image.',
    'Both points captured. Tap "Apply & Broadcast" to calibrate.',
  ];

  if (!mapOverlay) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Map Calibration</Text>
          <View style={styles.closeButton} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>No map overlay configured.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Map Calibration</Text>
        <TouchableOpacity onPress={handleReset} style={styles.closeButton}>
          <Text style={[styles.closeText, points.length === 0 && styles.dimmed]}>Reset</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.instructionBox}>
        <Text style={styles.stepLabel}>Step {step} of 3</Text>
        <Text style={styles.instructionText}>{instructions[step - 1]}</Text>
        {!myLocation && (
          <Text style={styles.noGpsText}>No Beacon GPS fix yet — waiting for position packet</Text>
        )}
      </View>

      <View style={styles.imageContainer}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleImageTap}
          disabled={points.length >= 2}
        >
          <Image
            source={{ uri: mapOverlay.image }}
            style={styles.mapImage}
            resizeMode="contain"
            onLayout={handleImageLayout}
          />

          {imageLayout && points.map((pt, i) => (
            <View
              key={i}
              style={[
                styles.pin,
                {
                  left: pt.imageX * imageLayout.width - 12,
                  top: pt.imageY * imageLayout.height - 24,
                },
              ]}
            >
              <Text style={styles.pinLabel}>{i === 0 ? 'A' : 'B'}</Text>
            </View>
          ))}
        </TouchableOpacity>
      </View>

      {points.length > 0 && (
        <View style={styles.coordsBox}>
          {points.map((pt, i) => (
            <Text key={i} style={styles.coordText}>
              {i === 0 ? 'A' : 'B'}: {pt.gps.lat.toFixed(5)}, {pt.gps.lng.toFixed(5)}
            </Text>
          ))}
        </View>
      )}

      {points.length === 2 && !pointsSeparated && (
        <Text style={styles.warningText}>Points too close together — tap further apart spots.</Text>
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.applyButton, (!pointsSeparated || applying) && styles.applyButtonDisabled]}
          onPress={handleApply}
          disabled={!pointsSeparated || applying}
        >
          {applying
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.applyButtonText}>Apply & Broadcast</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.clearButton} onPress={handleClearCalibration}>
          <Text style={styles.clearButtonText}>Clear saved calibration</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: Colors.textSecondary, fontSize: FontSize.md },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  closeButton: { minWidth: 60 },
  closeText: { fontSize: FontSize.sm, color: Colors.primary },
  dimmed: { opacity: 0.3 },

  instructionBox: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stepLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 2 },
  instructionText: { fontSize: FontSize.sm, color: Colors.textPrimary, lineHeight: 18 },
  noGpsText: { fontSize: FontSize.xs, color: Colors.warning, marginTop: Spacing.xs },

  imageContainer: {
    flex: 1,
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  mapImage: {
    width: '100%',
    aspectRatio: 1,
  },

  pin: {
    position: 'absolute',
    width: 24,
    height: 28,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pinLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#fff',
    backgroundColor: Colors.primary,
    borderRadius: 12,
    width: 24,
    height: 24,
    textAlign: 'center',
    lineHeight: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 4,
  },

  coordsBox: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.surfaceElevated,
  },
  coordText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontFamily: 'monospace' },

  warningText: {
    fontSize: FontSize.xs,
    color: Colors.warning,
    textAlign: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },

  footer: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  applyButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  applyButtonDisabled: { opacity: 0.35 },
  applyButtonText: { color: '#fff', fontWeight: '700', fontSize: FontSize.md },
  clearButton: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  clearButtonText: { color: Colors.textSecondary, fontSize: FontSize.xs },
});
