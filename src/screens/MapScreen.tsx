import React, { useRef, useEffect } from 'react';
import {
  View, StyleSheet, Text, Image, ScrollView, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, BorderRadius } from '../config/theme';
import { useCrewStore } from '../store/useCrewStore';
import { festivalConfig } from '../services/festival/FestivalConfig';
import BeaconHeader from '../components/common/BeaconHeader';
import ConnectionBar from '../components/common/ConnectionBar';
import { gpsToMapPixel, MAP_IMG_W, MAP_IMG_H } from '../utils/coordinates';

const config = festivalConfig.getConfig();

export const CREW_COLORS = [
  '#e91e63', '#2196f3', '#00bcd4', '#8bc34a',
  '#ff9800', '#9c27b0', '#ffeb3b', '#ff5252',
] as const;
const mapImage = require('../assets/lib-2026-map.png');

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const AVAILABLE_H = SCREEN_H - 160;
const SCALE = AVAILABLE_H / MAP_IMG_H;
const RENDERED_W = MAP_IMG_W * SCALE;
const RENDERED_H = MAP_IMG_H * SCALE;

function gpsToPixel(lat: number, lng: number): { x: number; y: number } | null {
  const raw = gpsToMapPixel(lat, lng);
  if (!raw) return null;
  return { x: raw.x * SCALE, y: raw.y * SCALE };
}

export default function MapScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const crewMembers = useCrewStore(s => s.crewMembers);
  const myLocation = useCrewStore(s => s.myLocation);
  const focusNodeId = useCrewStore(s => s.focusNodeId);
  const setFocusNode = useCrewStore(s => s.setFocusNode);
  const hasCentered = useRef(false);

  const crewWithLocation = Object.values(crewMembers).filter(
    m => !m.isSelf && m.lat !== undefined && m.lng !== undefined
  );

  // Center on user's GPS position when available
  useEffect(() => {
    if (hasCentered.current) return;
    const loc = myLocation ?? { lat: config.venue.center.lat, lng: config.venue.center.lng };
    const pos = gpsToPixel(loc.lat, loc.lng);
    const x = pos ? Math.max(0, pos.x - SCREEN_W / 2) : (RENDERED_W - SCREEN_W) / 2;
    scrollRef.current?.scrollTo({ x, y: 0, animated: false });
    if (myLocation) hasCentered.current = true;
  }, [myLocation]);

  // Focus on a crew member when navigated from Crew tab
  useEffect(() => {
    if (!focusNodeId) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const member = crewMembers[focusNodeId];
    if (member?.lat && member?.lng) {
      const pos = gpsToPixel(member.lat, member.lng);
      if (pos) {
        const zoom = 2.25;
        const w = SCREEN_W / zoom;
        const h = RENDERED_H / zoom;
        timers.push(setTimeout(() => {
          (scrollRef.current as any)?.scrollResponderZoomTo({
            x: Math.max(0, pos.x - w / 2),
            y: Math.max(0, pos.y - h / 2),
            width: w,
            height: h,
            animated: true,
          });
        }, 300));
      }
    }
    timers.push(setTimeout(() => setFocusNode(null), 600));
    return () => timers.forEach(clearTimeout);
  }, [focusNodeId]);

  return (
    <SafeAreaView style={styles.container}>
      <BeaconHeader title="Festival Map" subtitle={`${crewWithLocation.length} crew located`} />
      <ConnectionBar />
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        horizontal
        maximumZoomScale={5}
        minimumZoomScale={1}
        bouncesZoom
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: (RENDERED_W - SCREEN_W) / 2, y: 0 }}
      >
        <View style={styles.mapContainer}>
          <Image source={mapImage} style={styles.mapImage} />

          {/* Now playing / up next at stages */}
          {config.stages.map(stage => {
            const pos = gpsToPixel(stage.location.lat, stage.location.lng);
            if (!pos) return null;
            const now = festivalConfig.getNowPlaying(stage.id);
            const next = !now ? festivalConfig.getUpNext(stage.id) : null;
            const slot = now ?? next;
            if (!slot) return null;
            return (
              <View
                key={stage.id}
                style={[styles.nowPlaying, { left: pos.x - 40, top: pos.y - 10 }]}
              >
                <Text style={styles.nowPlayingText} numberOfLines={1}>
                  {now ? slot.artistName : `Next: ${slot.artistName}`}
                </Text>
              </View>
            );
          })}

          {/* Crew pins */}
          {crewWithLocation.map(member => {
            const pos = gpsToPixel(member.lat!, member.lng!);
            if (!pos) return null;
            const bg = member.color ?? Colors.primary;
            return (
              <View key={member.nodeId} style={[styles.crewPin, { left: pos.x - 10, top: pos.y - 26 }]}>
                <View style={[styles.crewPinCircle, { backgroundColor: bg }]}>
                  <Text style={styles.crewPinText}>{member.shortName.slice(0, 2).toUpperCase()}</Text>
                </View>
                <View style={[styles.crewPinTail, { borderTopColor: bg }]} />
              </View>
            );
          })}

          {/* My location */}
          {myLocation && (() => {
            const pos = gpsToPixel(myLocation.lat, myLocation.lng);
            if (!pos) return null;
            return (
              <View style={[styles.myPin, { left: pos.x - 11, top: pos.y - 11 }]}>
                <View style={styles.myPinDot} />
              </View>
            );
          })()}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  mapContainer: {
    width: RENDERED_W,
    height: RENDERED_H,
  },
  mapImage: {
    width: RENDERED_W,
    height: RENDERED_H,
  },
  nowPlaying: {
    position: 'absolute',
    backgroundColor: Colors.surface + 'cc',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    maxWidth: 80,
  },
  nowPlayingText: { fontSize: 9, color: Colors.textSecondary, fontWeight: '700' },
  crewPin: {
    position: 'absolute',
    alignItems: 'center',
  },
  crewPinCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crewPinText: { color: '#fff', fontWeight: '900', fontSize: 8 },
  crewPinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  myPin: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#4fc3f744',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#4fc3f7',
  },
  myPinDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#4fc3f7',
  },
});
