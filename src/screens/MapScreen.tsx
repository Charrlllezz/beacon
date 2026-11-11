import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, StyleSheet, Text, TouchableOpacity, Pressable, Modal, TextInput, ScrollView, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, UrlTile, PROVIDER_DEFAULT } from 'react-native-maps';
import { getTilePath } from '../services/map/TilePrefetch';
import { useOfflineMapStore } from '../store/useOfflineMapStore';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Colors, Spacing, FontSize, BorderRadius, Fonts, CREW_PALETTE, crewColor } from '../config/theme';
import { DEMO } from '../config/demo';
import Icon from '../components/ui/Icon';
import Glass from '../components/ui/Glass';
import type { CrewMember } from '../types/crew';
import { useCrewStore, type FocusPoint } from '../store/useCrewStore';
import { useTagStore } from '../store/useTagStore';
import { festivalConfig } from '../services/festival/FestivalConfig';
import RNDVUHeader from '../components/common/RNDVUHeader';
import ConnectionBar from '../components/common/ConnectionBar';
import TaggedPOIPin from '../components/map/TaggedPOIPin';
import TagLocationSheet from '../components/map/TagLocationSheet';
import FirstOpenTip from '../components/common/FirstOpenTip';
import { bleService } from '../services/ble/BleManager';
import { buildTagMessage, parseMessage } from '../services/mesh/MessageService';
import { useMessagesStore } from '../store/useMessagesStore';
import { useDeviceStore } from '../store/useDeviceStore';
import { hapticMedium } from '../utils/haptics';
import { pinAge } from '../utils/pinAge';
import { PHONE_DEAD_TIP } from '../config/safetyCopy';
import type { TagCategory, TagScope, TaggedPOI } from '../types/festival';

const CATEGORY_COLORS: Record<TagCategory, string> = {
  stage: '#e040fb',
  food: '#ff9800',
  water: '#29b6f6',
  restroom: '#66bb6a',
  camp: '#8d6e63',
  custom: '#78909c',
};

const CATEGORY_FILTERS: { key: TagCategory; color: string; label: string }[] = [
  { key: 'stage', color: CATEGORY_COLORS.stage, label: 'Stages' },
  { key: 'food', color: CATEGORY_COLORS.food, label: 'Food' },
  { key: 'water', color: CATEGORY_COLORS.water, label: 'Water' },
  { key: 'restroom', color: CATEGORY_COLORS.restroom, label: 'Restrooms' },
  { key: 'camp', color: CATEGORY_COLORS.camp, label: 'Camp' },
  { key: 'custom', color: CATEGORY_COLORS.custom, label: 'Other' },
];

export const CREW_COLORS = CREW_PALETTE;

// Pins glide: a friend's pin moves to its new spot over this long instead of
// jumping, and one soft ring pulses out from it so you see who just updated.
const GLIDE_MS = 800;
const PULSE_MS = 900;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

interface CrewPinProps {
  member: CrewMember;
  now: number;
  onPress: (lat: number, lng: number) => void;
}

/**
 * One friend on the map. Holds the coordinate it's showing and tweens it to
 * the new one on each update (a few dozen re-renders of one marker, no native
 * animation API needed). The Marker inside is re-keyed when the age label
 * changes (tracksViewChanges is off); this component, and so the shown
 * position, survives that.
 */
function CrewPin({ member, now, onPress }: CrewPinProps) {
  const target = { latitude: member.lat!, longitude: member.lng! };
  const [coord, setCoord] = useState(target);
  const shown = useRef(target);
  const [moving, setMoving] = useState(false);
  const ring = useSharedValue(1);

  useEffect(() => {
    const from = shown.current;
    if (from.latitude === target.latitude && from.longitude === target.longitude) return;
    const began = Date.now();
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | null = null;
    setMoving(true);
    ring.value = 0;
    ring.value = withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) });
    const step = () => {
      const e = easeInOut(Math.min(1, (Date.now() - began) / GLIDE_MS));
      const c = {
        latitude: from.latitude + (target.latitude - from.latitude) * e,
        longitude: from.longitude + (target.longitude - from.longitude) * e,
      };
      shown.current = c;
      setCoord(c);
      if (e < 1) frame = requestAnimationFrame(step);
      else settle = setTimeout(() => setMoving(false), PULSE_MS - GLIDE_MS + 100);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); if (settle) clearTimeout(settle); };
  }, [target.latitude, target.longitude]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.6 * (1 - ring.value),
    transform: [{ scale: 1 + 1.6 * ring.value }],
  }));

  const bg = crewColor(member.nodeId, member.color);
  const initials = member.shortName.slice(0, 2).toUpperCase();
  const age = pinAge(member.locationAt, now);
  return (
    <Marker
      // tracksViewChanges is off, so the key carries the label: a new label
      // re-creates the marker and the view updates. On while it moves, so the
      // pulse ring draws.
      key={`${age.label}-${age.stale ? 's' : 'f'}`}
      coordinate={coord}
      tracksViewChanges={moving}
      onPress={() => onPress(member.lat!, member.lng!)}
    >
      <View style={styles.crewPinContainer}>
        <View style={styles.crewPinStack}>
          <Animated.View style={[styles.crewPinRing, { backgroundColor: bg }, ringStyle]} />
          {/* Fade the pin, not its age label: on a stale pin the age is the
              thing to read. */}
          <View style={[styles.crewPinCircle, { backgroundColor: bg }, age.stale && styles.crewPinFaded, age.stale && styles.crewPinDashed]}>
            <Text style={styles.crewPinText}>{initials}</Text>
          </View>
        </View>
        <View style={[styles.crewPinTail, { borderTopColor: '#ffffff' }, age.stale && styles.crewPinFaded]} />
        <Text style={[styles.crewPinAge, age.stale && styles.crewPinAgeStale]}>{age.label}</Text>
      </View>
    </Marker>
  );
}

export default function MapScreen() {
  // Active festival (App.tsx remounts the tabs when it changes).
  const config = festivalConfig.getConfig();
  const mapRef = useRef<MapView>(null);
  const crewMembers = useCrewStore(s => s.crewMembers);
  const myLocation = useCrewStore(s => s.myLocation);
  const focusNodeId = useCrewStore(s => s.focusNodeId);
  const setFocusNode = useCrewStore(s => s.setFocusNode);
  const focusPoint = useCrewStore(s => s.focusPoint);
  // The last rally/SOS spot opened from chat, pinned until another replaces it.
  const [droppedPin, setDroppedPin] = useState<FocusPoint | null>(null);
  // Sent here to see a friend ("Show on map"): show them, not the first-visit
  // tutorial. The tutorial waits for the next time you open the map.
  const [tipDeferred, setTipDeferred] = useState(focusNodeId !== null || focusPoint !== null);
  React.useEffect(() => {
    if (focusNodeId !== null || focusPoint !== null) setTipDeferred(true);
  }, [focusNodeId, focusPoint]);
  // Decided on arrival: clearing it on the way out would pop the tutorial
  // (a Modal) over whichever tab you went to.
  useFocusEffect(useCallback(() => {
    const { focusNodeId: node, focusPoint: point } = useCrewStore.getState();
    setTipDeferred(node !== null || point !== null);
  }, []));
  const tags = useTagStore(s => s.tags);
  const addTag = useTagStore(s => s.addTag);
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  const addMessage = useMessagesStore(s => s.addMessage);

  const [tagCoord, setTagCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<TagCategory>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);

  // Render the cached-tile overlay right away — UrlTile serves from the on-disk
  // cache and transparently falls back to the network when online, so there's
  // no reason to gate it on prefetch completion. Gating used to leave tilesReady
  // false forever if the prefetch promise rejected, hiding the satellite layer
  // entirely. The download itself is owned by useOfflineMapStore (started at
  // launch/foreground from App.tsx); this is a no-op if it's already running
  // or done.
  useEffect(() => {
    setTilesReady(true);
    useOfflineMapStore.getState().ensure(config);
  }, [config.festival.id]);

  const hasFix = !!myLocation && !(myLocation.lat === 0 && myLocation.lng === 0);

  // Use satellite view when near venue, standard otherwise
  const isNearVenue = myLocation
    ? Math.abs(myLocation.lat - config.venue.center.lat) < 0.05 &&
      Math.abs(myLocation.lng - config.venue.center.lng) < 0.05
    : false;

  // Ticks every 30 s so pin-age labels count up while the map is open.
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(t);
  }, []);

  const crewWithLocation = Object.values(crewMembers).filter(
    m => !m.isSelf && m.lat !== undefined && m.lng !== undefined
  );

  const toggleCategory = useCallback((cat: TagCategory) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const hasActiveFilters = searchQuery.length > 0 || activeCategories.size > 0;

  const filteredTags = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return tags.filter(tag => {
      if (activeCategories.size > 0 && !activeCategories.has(tag.category)) return false;
      if (q && !tag.name.toLowerCase().includes(q) && !tag.createdBy.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tags, searchQuery, activeCategories]);

  // Hide stage markers when filtering by non-stage categories (or searching)
  const showStages = activeCategories.size === 0 || activeCategories.has('stage');

  const handleSearchResult = useCallback((tag: TaggedPOI) => {
    mapRef.current?.animateToRegion({
      latitude: tag.lat,
      longitude: tag.lng,
      latitudeDelta: 0.002,
      longitudeDelta: 0.002,
    }, 400);
    setSearchQuery('');
    setShowFilters(false);
  }, []);

  // Focus on crew member when navigated from Crew tab
  React.useEffect(() => {
    if (!focusNodeId) return;
    const member = crewMembers[focusNodeId];
    if (member?.lat && member?.lng) {
      mapRef.current?.animateToRegion({
        latitude: member.lat,
        longitude: member.lng,
        latitudeDelta: 0.002,
        longitudeDelta: 0.002,
      }, 500);
    }
    setTimeout(() => setFocusNode(null), 600);
  }, [focusNodeId]);

  // Focus on a spot when sent here from a chat card's "Open Map"
  React.useEffect(() => {
    if (!focusPoint) return;
    if (focusPoint.kind !== 'tag') setDroppedPin(focusPoint);
    mapRef.current?.animateToRegion({
      latitude: focusPoint.lat,
      longitude: focusPoint.lng,
      latitudeDelta: 0.002,
      longitudeDelta: 0.002,
    }, 500);
    setTimeout(() => useCrewStore.getState().setFocusPoint(null), 600);
  }, [focusPoint]);

  // Center on current location when the tab gains focus, and only then. Read
  // the store directly: depending on myLocation re-ran this on every 5 m GPS
  // update, snapping the map back to you while you panned to look at the
  // crew, and clearing focusNodeId re-ran it too, undoing "show on map".
  useFocusEffect(
    useCallback(() => {
      const { focusNodeId: node, focusPoint: point } = useCrewStore.getState();
      if (node || point) return; // the focus effects handle these cases

      const timer = setTimeout(() => {
        const loc = useCrewStore.getState().myLocation;
        if (loc) {
          mapRef.current?.animateToRegion({
            latitude: loc.lat,
            longitude: loc.lng,
            latitudeDelta: 0.004,
            longitudeDelta: 0.004,
          }, 400);
        }
      }, 300);

      return () => clearTimeout(timer);
    }, [])
  );

  const handleLongPress = useCallback((e: any) => {
    const coord = e.nativeEvent.coordinate;
    hapticMedium();
    setTagCoord(coord);
  }, []);

  const handleCenterOnMe = useCallback(() => {
    if (!myLocation) return;
    mapRef.current?.animateToRegion({
      latitude: myLocation.lat,
      longitude: myLocation.lng,
      latitudeDelta: 0.003,
      longitudeDelta: 0.003,
    }, 400);
  }, [myLocation]);

  const handleTagSubmit = useCallback(async (name: string, category: TagCategory, scope: TagScope) => {
    if (!tagCoord) return;
    if (!myNodeNum) {
      Alert.alert('Not Ready', 'Still connecting to your device — try again in a moment.');
      return;
    }
    const myName = crewMembers[myNodeNum]?.longName ?? 'You';
    // Channel 0 always — community scope (channel 1) isn't provisioned in
    // Model 1. When Model 2 adds per-crew channels, route via scope again.
    const channelIndex = 0;

    const tag: TaggedPOI = {
      id: `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      category,
      scope,
      lat: tagCoord.latitude,
      lng: tagCoord.longitude,
      createdBy: myName,
      createdAt: Date.now(),
      confirmCount: 0,
    };

    addTag(tag);

    const wireMsg = buildTagMessage(tagCoord.latitude, tagCoord.longitude, name, category);
    const selfId = `self-tag-${Date.now()}`;
    const msg = parseMessage(wireMsg, myNodeNum, myName, Date.now(), channelIndex);
    addMessage({ ...msg, id: selfId, sendStatus: 'sending' });

    try {
      await bleService.sendText(wireMsg, channelIndex);
      useMessagesStore.getState().setSendStatus(selfId, 'sent');
    } catch (e) {
      console.warn('Tag send failed:', e);
      useMessagesStore.getState().setSendStatus(selfId, 'failed');
      Alert.alert('Tag Failed', 'Tag was saved locally but could not be broadcast to your crew.');
    }

    setTagCoord(null);
  }, [tagCoord, myNodeNum, crewMembers, addTag, addMessage]);

  return (
    <SafeAreaView style={styles.container}>
      <RNDVUHeader title="Map" subtitle={`${crewWithLocation.length} crew located`} />
      <ConnectionBar />

      <View style={styles.mapWrapper}>
        {/* Always show the map: with no GPS fix yet (indoors at the gate, or
            location off) the crew pins and tags are still useful. */}
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          // Demo: Apple's dark, muted map so the crew pins carry the colour.
          // Real builds keep satellite at the venue: the offline tile cache
          // below is satellite imagery, and the dark map has no offline copy.
          mapType={DEMO ? 'mutedStandard' : isNearVenue ? 'satellite' : 'standard'}
          userInterfaceStyle="dark"
          // First visit straight from a chat card: start on that spot, since
          // the map isn't ready to animate yet.
          initialRegion={focusPoint ? {
            latitude: focusPoint.lat,
            longitude: focusPoint.lng,
            latitudeDelta: 0.002,
            longitudeDelta: 0.002,
          } : {
            latitude: hasFix ? myLocation!.lat : config.venue.center.lat,
            longitude: hasFix ? myLocation!.lng : config.venue.center.lng,
            latitudeDelta: 0.006,
            longitudeDelta: 0.006,
          }}
          onLongPress={handleLongPress}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
        >
          {/* Offline satellite tiles - cached for festival use */}
          {tilesReady && !DEMO && (
            <UrlTile
              urlTemplate="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              // Tiles are cached to z18; past that, scale them up instead
              // of showing nothing offline.
              maximumZ={20}
              maximumNativeZ={18}
              minimumZ={14}
              tileCachePath={getTilePath()}
              offlineMode={isNearVenue}
              tileSize={256}
              zIndex={-1}
            />
          )}

          {/* Stage markers disabled — coordinates not accurate enough */}

          {/* Community-tagged POIs (filtered) */}
          {filteredTags.map(tag => (
            <TaggedPOIPin key={tag.id} poi={tag} onPress={handleSearchResult} />
          ))}

          {droppedPin && (
            <Marker
              coordinate={{ latitude: droppedPin.lat, longitude: droppedPin.lng }}
              title={droppedPin.label}
              pinColor={droppedPin.kind === 'sos' ? Colors.error : Colors.primary}
            />
          )}

          {/* Self location handled by showsUserLocation (native blue dot) */}

          {/* Crew pins, labelled with how old the position is and faded once
              stale, so a 40-minute-old pin doesn't look live. */}
          {crewWithLocation.map(member => (
            <CrewPin
              key={member.nodeId}
              member={member}
              now={now}
              onPress={(lat, lng) => mapRef.current?.animateToRegion({
                latitude: lat,
                longitude: lng,
                latitudeDelta: 0.002,
                longitudeDelta: 0.002,
              }, 500)}
            />
          ))}
        </MapView>

        {!hasFix && (
          <View style={styles.noFixBanner} pointerEvents="none">
            <Text style={styles.noFixText}>No GPS fix yet. Showing the venue; crew pins still update.</Text>
          </View>
        )}

        {/* Search & filter overlay */}
        <View style={styles.filterOverlay}>
          <View style={styles.searchRow}>
            <Glass style={styles.searchBar} radius={BorderRadius.full}>
              <View style={styles.searchIcon}><Icon name="magnifyingglass" size={15} color={Colors.textSecondary} /></View>
              <TextInput
                style={styles.searchInput}
                placeholder="Search tags..."
                placeholderTextColor={Colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={() => setShowFilters(true)}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" style={styles.clearBtn}>
                  <Icon name="xmark.circle.fill" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </Glass>
            <TouchableOpacity
              onPress={() => setShowFilters(prev => !prev)}
              accessibilityRole="button"
              accessibilityLabel="Filters"
            >
              <Glass style={[styles.filterToggle, hasActiveFilters && styles.filterToggleActive]} radius={20}>
                <Icon name="line.3.horizontal.decrease" size={18} color={hasActiveFilters ? Colors.primary : Colors.textPrimary} weight="semibold" />
              </Glass>
            </TouchableOpacity>
          </View>

          {showFilters && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipRow}
              contentContainerStyle={styles.chipRowContent}
            >
              {CATEGORY_FILTERS.map(cat => {
                const active = activeCategories.has(cat.key);
                return (
                  <TouchableOpacity
                    key={cat.key}
                    style={[styles.chip, active && { borderColor: cat.color, backgroundColor: cat.color + '22' }]}
                    onPress={() => toggleCategory(cat.key)}
                  >
                    <View style={[styles.chipDot, { backgroundColor: cat.color }]} />
                    <Text style={[styles.chipLabel, active && { color: cat.color }]}>{cat.label}</Text>
                  </TouchableOpacity>
                );
              })}
              {hasActiveFilters && (
                <TouchableOpacity
                  style={styles.clearFilters}
                  onPress={() => { setActiveCategories(new Set()); setSearchQuery(''); }}
                >
                  <Text style={styles.clearFiltersText}>Clear</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}

          {/* Search results dropdown */}
          {searchQuery.length > 0 && filteredTags.length > 0 && showFilters && (
            <View style={styles.searchResults}>
              {filteredTags.slice(0, 5).map(tag => (
                <TouchableOpacity
                  key={tag.id}
                  style={styles.searchResultItem}
                  onPress={() => handleSearchResult(tag)}
                >
                  <View style={[styles.searchResultDot, { backgroundColor: CATEGORY_COLORS[tag.category] ?? CATEGORY_COLORS.custom }]} />
                  <View style={styles.searchResultText}>
                    <Text style={styles.searchResultName} numberOfLines={1}>{tag.name}</Text>
                    <Text style={styles.searchResultMeta}>{tag.scope} · {tag.createdBy}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {filteredTags.length > 5 && (
                <Text style={styles.searchResultMore}>+{filteredTags.length - 5} more</Text>
              )}
            </View>
          )}
        </View>

        {/* Floating buttons */}
        <View style={styles.bottomBar}>
          <TouchableOpacity onPress={handleCenterOnMe} accessibilityRole="button" accessibilityLabel="Center on me">
            <Glass style={styles.centerBtn} radius={22}>
              <Icon name="location.fill" size={18} color={Colors.primary} />
            </Glass>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Tag Spot"
            onPress={() => {
              if (myLocation) {
                hapticMedium();
                setTagCoord({ latitude: myLocation.lat, longitude: myLocation.lng });
              }
            }}
          >
            <Glass style={styles.tagBtn} radius={BorderRadius.full}>
              <Icon name="plus" size={15} color={Colors.primary} weight="bold" />
              <Text style={styles.tagBtnText}>Tag Spot</Text>
            </Glass>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tag location bottom sheet */}
      <Modal
        visible={tagCoord !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setTagCoord(null)}
      >
        {/* Lifts the sheet above the keyboard, which otherwise covered it all
            while you typed the name. accessible={false}: a Pressable is one
            VoiceOver element by default, which hid the sheet's controls. */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setTagCoord(null)} accessible={false}>
            <Pressable
              style={styles.sheetContent}
              onPress={() => {}}
              accessible={false}
              accessibilityViewIsModal
              onAccessibilityEscape={() => setTagCoord(null)}
            >
              {tagCoord && (
                <TagLocationSheet
                  coordinate={tagCoord}
                  onSubmit={handleTagSubmit}
                  onCancel={() => setTagCoord(null)}
                />
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <FirstOpenTip
        // v2: re-shown once so existing testers learn about pin age.
        storageKey="rndvu_tip_map_v2"
        deferred={tipDeferred}
        title="Your Crew Map"
        tips={[
          { icon: 'mappin.and.ellipse', title: 'Crew Pins', description: "The label under a pin says how old it is. Faded pins are over 15 minutes old: where they were, not where they are." },
          { icon: 'battery.25percent', title: 'Phone dying?', description: PHONE_DEAD_TIP },
          { icon: 'tag', title: 'Tag Spots', description: 'Use the Tag Spot button to mark useful spots like water, food, or restrooms for your crew' },
          { icon: 'magnifyingglass', title: 'Search & Filter', description: 'Use the search bar and filter chips to find tagged locations' },
        ]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  mapWrapper: { flex: 1 },
  map: { flex: 1 },
  stagePin: {
    alignItems: 'center',
    maxWidth: 90,
  },
  stageDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  stageName: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  stageNow: {
    fontSize: 8,
    color: Colors.textSecondary,
    backgroundColor: Colors.surface + 'cc',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginTop: 1,
    overflow: 'hidden',
  },
  crewPinContainer: {
    alignItems: 'center',
  },
  crewPinStack: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  crewPinRing: { position: 'absolute', width: 32, height: 32, borderRadius: 16 },
  crewPinCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 5,
  },
  crewPinText: { color: '#1a1520', fontFamily: Fonts.rounded, fontWeight: '900', fontSize: 11 },
  crewPinAge: {
    marginTop: 2,
    fontFamily: Fonts.rounded,
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    backgroundColor: 'rgba(11, 10, 16, 0.78)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  crewPinAgeStale: { color: Colors.warning },
  crewPinFaded: { opacity: 0.4 },
  crewPinDashed: { borderStyle: 'dashed' },
  noFixBanner: {
    position: 'absolute', bottom: Spacing.md, left: Spacing.md, right: 72,
    backgroundColor: Colors.overlay, borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.glassBorder,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  noFixText: { color: Colors.textSecondary, fontSize: FontSize.xs },
  crewPinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -2,
  },
  filterOverlay: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    right: Spacing.sm,
    zIndex: 10,
  },
  searchRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    height: 42,
  },
  searchIcon: { marginRight: Spacing.sm },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    padding: 0,
  },
  clearBtn: { paddingLeft: Spacing.xs },
  filterToggle: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterToggleActive: {
    borderColor: Colors.primary,
  },
  chipRow: {
    marginTop: Spacing.xs,
  },
  chipRowContent: {
    gap: Spacing.xs,
    paddingRight: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(22, 20, 28, 0.88)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipLabel: { color: Colors.textSecondary, fontFamily: Fonts.rounded, fontSize: FontSize.xs + 1, fontWeight: '700' },
  clearFilters: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  clearFiltersText: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '600' },
  searchResults: {
    marginTop: Spacing.xs,
    backgroundColor: 'rgba(22, 20, 28, 0.96)',
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    overflow: 'hidden',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  searchResultDot: { width: 10, height: 10, borderRadius: 5 },
  searchResultText: { flex: 1 },
  searchResultName: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '600' },
  searchResultMeta: { color: Colors.textSecondary, fontSize: FontSize.xs },
  searchResultMore: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    textAlign: 'center',
    paddingVertical: Spacing.xs,
  },
  bottomBar: {
    position: 'absolute',
    bottom: Spacing.lg,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  centerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: Spacing.lg,
  },
  tagBtnText: { color: Colors.textPrimary, fontFamily: Fonts.rounded, fontSize: FontSize.md, fontWeight: '700' },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetContent: {},
});
