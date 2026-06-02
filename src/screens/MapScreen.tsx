import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Pressable, Modal, TextInput, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, UrlTile, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { prefetchVenueTiles, isTilesPrefetched, getTilePath } from '../services/map/TilePrefetch';
import { Colors, Spacing, FontSize, BorderRadius } from '../config/theme';
import { useCrewStore } from '../store/useCrewStore';
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

export const CREW_COLORS = [
  '#e91e63', '#2196f3', '#00bcd4', '#8bc34a',
  '#ff9800', '#9c27b0', '#ffeb3b', '#ff5252',
] as const;

const config = festivalConfig.getConfig();

const INITIAL_REGION: Region = {
  latitude: config.venue.center.lat,
  longitude: config.venue.center.lng,
  latitudeDelta: 0.006,
  longitudeDelta: 0.006,
};

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const crewMembers = useCrewStore(s => s.crewMembers);
  const myLocation = useCrewStore(s => s.myLocation);
  const focusNodeId = useCrewStore(s => s.focusNodeId);
  const setFocusNode = useCrewStore(s => s.setFocusNode);
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
  // entirely. Warm the cache in the background regardless.
  useEffect(() => {
    setTilesReady(true);
    if (!isTilesPrefetched()) {
      prefetchVenueTiles().catch((e) => console.warn('Tile prefetch failed (non-fatal):', e));
    }
  }, []);

  // Use satellite view when near venue, standard otherwise
  const isNearVenue = myLocation
    ? Math.abs(myLocation.lat - config.venue.center.lat) < 0.05 &&
      Math.abs(myLocation.lng - config.venue.center.lng) < 0.05
    : false;

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

  // Center on current location each time the tab is focused
  useFocusEffect(
    useCallback(() => {
      if (focusNodeId) return; // crew-focus effect handles this case

      const timer = setTimeout(() => {
        if (myLocation) {
          mapRef.current?.animateToRegion({
            latitude: myLocation.lat,
            longitude: myLocation.lng,
            latitudeDelta: 0.004,
            longitudeDelta: 0.004,
          }, 400);
        }
      }, 300);

      return () => clearTimeout(timer);
    }, [focusNodeId, myLocation])
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
        {(!myLocation || (myLocation.lat === 0 && myLocation.lng === 0)) && (
          <View style={[styles.map, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: Colors.textSecondary }}>Getting your location...</Text>
          </View>
        )}
        {myLocation && !(myLocation.lat === 0 && myLocation.lng === 0) && <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          mapType={isNearVenue ? 'satellite' : 'standard'}
          initialRegion={{
            latitude: myLocation.lat,
            longitude: myLocation.lng,
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
          {tilesReady && (
            <UrlTile
              urlTemplate="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maximumZ={18}
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

          {/* Self location handled by showsUserLocation (native blue dot) */}

          {/* Crew pins */}
          {crewWithLocation.map(member => {
            const bg = member.color ?? Colors.primary;
            const initials = member.shortName.slice(0, 2).toUpperCase();
            return (
              <Marker
                key={member.nodeId}
                coordinate={{ latitude: member.lat!, longitude: member.lng! }}
                tracksViewChanges={false}
                onPress={() => {
                  mapRef.current?.animateToRegion({
                    latitude: member.lat!,
                    longitude: member.lng!,
                    latitudeDelta: 0.002,
                    longitudeDelta: 0.002,
                  }, 500);
                }}
              >
                <View style={styles.crewPinContainer}>
                  <View style={[styles.crewPinCircle, { backgroundColor: bg }]}>
                    <Text style={styles.crewPinText}>{initials}</Text>
                  </View>
                  <View style={[styles.crewPinTail, { borderTopColor: bg }]} />
                </View>
              </Marker>
            );
          })}
        </MapView>}

        {/* Search & filter overlay */}
        <View style={styles.filterOverlay}>
          <View style={styles.searchRow}>
            <View style={styles.searchBar}>
              <Text style={styles.searchIcon}>&#x1F50D;</Text>
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
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Text style={styles.clearBtn}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[styles.filterToggle, hasActiveFilters && styles.filterToggleActive]}
              onPress={() => setShowFilters(prev => !prev)}
            >
              <Text style={styles.filterToggleText}>☰</Text>
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
          <TouchableOpacity style={styles.centerBtn} onPress={handleCenterOnMe}>
            <Text style={styles.centerBtnText}>◎</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tagBtn}
            onPress={() => {
              if (myLocation) {
                hapticMedium();
                setTagCoord({ latitude: myLocation.lat, longitude: myLocation.lng });
              }
            }}
          >
            <Text style={styles.tagBtnText}>+ Tag Spot</Text>
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
        <Pressable style={styles.sheetBackdrop} onPress={() => setTagCoord(null)}>
          <Pressable style={styles.sheetContent} onPress={() => {}}>
            {tagCoord && (
              <TagLocationSheet
                coordinate={tagCoord}
                onSubmit={handleTagSubmit}
                onCancel={() => setTagCoord(null)}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <FirstOpenTip
        storageKey="rndvu_tip_map"
        title="Your Crew Map"
        tips={[
          { icon: '📍', title: 'Crew Pins', description: "Tap a crew member's pin to zoom in on their location" },
          { icon: '🏷️', title: 'Tag Spots', description: 'Use the Tag Spot button to mark useful spots like water, food, or restrooms for your crew' },
          { icon: '🔍', title: 'Search & Filter', description: 'Use the search bar and filter chips to find tagged locations' },
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
  crewPinCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crewPinText: { color: '#fff', fontWeight: '900', fontSize: 9 },
  crewPinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
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
    backgroundColor: Colors.surface + 'ee',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: { fontSize: 14, marginRight: Spacing.xs },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    padding: 0,
  },
  clearBtn: { color: Colors.textSecondary, fontSize: 14, paddingLeft: Spacing.xs },
  filterToggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface + 'ee',
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterToggleActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '22',
  },
  filterToggleText: { color: Colors.textPrimary, fontSize: 18 },
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
    gap: 4,
    backgroundColor: Colors.surface + 'ee',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipLabel: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: '600' },
  clearFilters: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  clearFiltersText: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '600' },
  searchResults: {
    marginTop: Spacing.xs,
    backgroundColor: Colors.surface + 'f5',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
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
    borderRadius: 22,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  centerBtnText: { color: Colors.primary, fontSize: 22 },
  tagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  tagBtnText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetContent: {},
});
