import React, { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Modal, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, FontSize, BorderRadius } from '../config/theme';
import { useCrewStore } from '../store/useCrewStore';
import type { CrewSortMode } from '../store/useCrewStore';
import { useScheduleStore } from '../store/useScheduleStore';
import { useDeviceStore } from '../store/useDeviceStore';
import { festivalConfig } from '../services/festival/FestivalConfig';
import BeaconHeader from '../components/common/BeaconHeader';
import ConnectionBar from '../components/common/ConnectionBar';
import { timeAgo, isOnline } from '../utils/time';
import { batteryColor, batteryLabel } from '../utils/battery';
import { formatDistance, haversineDistance } from '../utils/coordinates';
import { buildColorMessage } from '../services/mesh/MessageService';
import { CREW_COLORS } from './MapScreen';
import type { CrewMember } from '../types/crew';
import type { Stage } from '../types/festival';

const BATTERY_CRITICAL = 15;

function signalBars(snr?: number): { bars: number; color: string } {
  if (snr === undefined) return { bars: 0, color: Colors.textMuted };
  if (snr >= 10) return { bars: 3, color: Colors.success };
  if (snr >= 3) return { bars: 2, color: Colors.warning };
  return { bars: 1, color: Colors.error };
}

interface CrewMemberCardProps {
  member: CrewMember;
  myLocation: { lat: number; lng: number } | null;
  onFindOnMap: (nodeId: number) => void;
  watchingStatus?: string;
  locationCtx?: string;
}

const CrewMemberCard = memo(({ member, myLocation, onFindOnMap, watchingStatus, locationCtx }: CrewMemberCardProps) => {
  const online = isOnline(member.lastHeard);
  const dist =
    myLocation && member.lat && member.lng
      ? haversineDistance(myLocation.lat, myLocation.lng, member.lat, member.lng)
      : null;
  const batColor = batteryColor(member.batteryLevel);
  const initials = member.shortName.slice(0, 2).toUpperCase();
  const lowBattery = member.batteryLevel !== undefined && member.batteryLevel <= BATTERY_CRITICAL;
  const signal = signalBars(member.snr);
  const hasLocation = member.lat !== undefined && member.lng !== undefined;

  return (
    <TouchableOpacity
      style={[styles.card, lowBattery && styles.cardLowBattery]}
      onPress={() => hasLocation && onFindOnMap(member.nodeId)}
      activeOpacity={hasLocation ? 0.7 : 1}
    >
      <View style={[styles.avatar, online && styles.avatarOnline, member.color && { borderColor: member.color }]}>
        <Text style={styles.avatarText}>{initials}</Text>
        <View style={[styles.statusDot, { backgroundColor: online ? Colors.success : '#2a2a3a' }]} />
      </View>

      <View style={styles.info}>
        <Text style={styles.name}>{member.longName}</Text>
        <View style={styles.meta}>
          {member.lastHeard && (
            <Text style={styles.metaText}>{timeAgo(member.lastHeard)}</Text>
          )}
          {locationCtx && (
            <Text style={styles.metaText}> · {locationCtx}</Text>
          )}
          {dist !== null && (
            <Text style={styles.metaText}> · {formatDistance(dist)}</Text>
          )}
        </View>
        {lowBattery && (
          <Text style={styles.lowBatteryText}>Low radio battery</Text>
        )}
        {watchingStatus && (
          <Text style={styles.watchingText}>{watchingStatus}</Text>
        )}
      </View>

      <View style={styles.rightCol}>
        {member.batteryLevel !== undefined && (
          <View style={styles.battery}>
            <Text style={[styles.batteryPct, { color: batColor }]}>
              {batteryLabel(member.batteryLevel)}
            </Text>
            <View style={styles.batteryTrack}>
              <View
                style={[
                  styles.batteryFill,
                  { width: `${member.batteryLevel}%` as any, backgroundColor: batColor },
                ]}
              />
            </View>
          </View>
        )}
        {online && member.snr !== undefined && (
          <View style={styles.signalRow}>
            {[1, 2, 3].map(i => (
              <View
                key={i}
                style={[
                  styles.signalBar,
                  { height: 4 + i * 3, backgroundColor: i <= signal.bars ? signal.color : Colors.textMuted + '33' },
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

export default function CrewScreen() {
  const getSortedMembers = useCrewStore(s => s.getSortedMembers);
  const crewMembers = useCrewStore(s => s.crewMembers);
  const myLocation = useCrewStore(s => s.myLocation);
  const myColor = useCrewStore(s => s.myColor);
  const setMyColor = useCrewStore(s => s.setMyColor);
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  const getActivePickForNode = useScheduleStore(s => s.getActivePickForNode);
  const goingEntries = useScheduleStore(s => s.goingEntries);
  const members = getSortedMembers();
  const sortMode = useCrewStore(s => s.sortMode);
  const setSortMode = useCrewStore(s => s.setSortMode);
  const setFocusNode = useCrewStore(s => s.setFocusNode);
  const navigation = useNavigation();
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selfMember = myNodeNum ? crewMembers[myNodeNum] : null;

  const handleFindOnMap = useCallback((nodeId: number) => {
    setFocusNode(nodeId);
    (navigation as any).navigate('Map');
  }, [navigation, setFocusNode]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    refreshTimer.current = setTimeout(() => setRefreshing(false), 800);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const handleColorPick = useCallback(async (color: string) => {
    setMyColor(color);
    setColorPickerVisible(false);
    const { bleService } = await import('../services/ble/BleManager');
    try { await bleService.sendText(buildColorMessage(color)); } catch {}
  }, [setMyColor]);

  const watchingStatusMap = useMemo(() => {
    const now = new Date();
    const map = new Map<number, string | undefined>();
    for (const member of members) {
      const activePick = getActivePickForNode(member.nodeId, (stageId, artistId) =>
        festivalConfig.getNowPlaying(stageId, now)?.artistId === artistId
      );
      if (activePick) {
        const stage = festivalConfig.getStage(activePick.stageId);
        const slot = stage?.schedule.find(s => s.artistId === activePick.artistId);
        if (slot && stage) { map.set(member.nodeId, `Watching ${slot.artistName} · ${stage.shortName}`); continue; }
      }
      const nodeEntries = goingEntries.filter(e => e.nodeId === member.nodeId);
      const upcoming = nodeEntries
        .map(e => { const stage = festivalConfig.getStage(e.stageId); const slot = stage?.schedule.find(s => s.artistId === e.artistId); return slot ? { stage, slot } : null; })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .filter(({ slot }) => new Date(slot.start) > now)
        .sort((a, b) => new Date(a.slot.start).getTime() - new Date(b.slot.start).getTime());
      if (upcoming.length > 0) {
        const { stage, slot } = upcoming[0];
        map.set(member.nodeId, `Up next: ${slot.artistName} · ${stage!.shortName}`);
      }
    }
    return map;
  }, [members, goingEntries, getActivePickForNode]);

  const locationCtxMap = useMemo(() => {
    const map = new Map<string, string | undefined>();
    const stages = festivalConfig.getAllStages();
    for (const member of members) {
      if (!member.lat || !member.lng) continue;
      const key = `${member.lat},${member.lng}`;
      if (map.has(key)) continue;
      let nearest: { stage: Stage; dist: number } | null = null;
      for (const stage of stages) {
        const dist = haversineDistance(member.lat, member.lng, stage.location.lat, stage.location.lng);
        if (dist <= 300 && (!nearest || dist < nearest.dist)) nearest = { stage, dist };
      }
      map.set(key, nearest ? `Near ${nearest.stage.shortName}` : undefined);
    }
    return map;
  }, [members]);

  const online = members.filter(m => isOnline(m.lastHeard));
  const offline = members.filter(m => !isOnline(m.lastHeard));

  const renderMember = useCallback((member: CrewMember) => (
    <CrewMemberCard
      key={member.nodeId}
      member={member}
      myLocation={myLocation}
      onFindOnMap={handleFindOnMap}
      watchingStatus={watchingStatusMap.get(member.nodeId)}
      locationCtx={locationCtxMap.get(`${member.lat},${member.lng}`)}
    />
  ), [myLocation, handleFindOnMap, watchingStatusMap, locationCtxMap]);

  return (
    <SafeAreaView style={styles.container}>
      <BeaconHeader
        title="Crew"
        subtitle={`${online.length} online`}
      />
      <ConnectionBar />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
        }
      >
        {/* You card */}
        {selfMember && (
          <>
            <Text style={styles.sectionLabel}>YOU</Text>
            <View style={[styles.card, styles.youCard]}>
              <TouchableOpacity
                style={[styles.avatar, { borderColor: myColor ?? Colors.primary }]}
                onPress={() => setColorPickerVisible(true)}
              >
                <Text style={styles.avatarText}>
                  {selfMember.shortName.slice(0, 2).toUpperCase()}
                </Text>
                <View style={[styles.statusDot, { backgroundColor: Colors.success }]} />
              </TouchableOpacity>
              <View style={styles.info}>
                <Text style={styles.name}>{selfMember.longName}</Text>
                <View style={styles.meta}>
                  {selfMember.batteryLevel !== undefined && (
                    <Text style={[styles.metaText, { color: batteryColor(selfMember.batteryLevel) }]}>
                      {batteryLabel(selfMember.batteryLevel)}
                    </Text>
                  )}
                  {selfMember.lat && selfMember.lng && locationCtxMap.get(`${selfMember.lat},${selfMember.lng}`) && (
                    <Text style={styles.metaText}> · {locationCtxMap.get(`${selfMember.lat},${selfMember.lng}`)}</Text>
                  )}
                </View>
              </View>
              <TouchableOpacity
                style={[styles.colorButton, { backgroundColor: myColor ?? Colors.primary }]}
                onPress={() => setColorPickerVisible(true)}
              >
                <Text style={styles.colorButtonText}>Color</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {online.length > 0 && (
          <>
            <View style={[styles.sectionRow, selfMember && { marginTop: Spacing.md }]}>
              <Text style={styles.sectionLabel}>CREW · {online.length}</Text>
              <View style={styles.sortToggle}>
                <TouchableOpacity
                  style={[styles.sortBtn, sortMode === 'alpha' && styles.sortBtnActive]}
                  onPress={() => setSortMode('alpha')}
                >
                  <Text style={[styles.sortBtnText, sortMode === 'alpha' && styles.sortBtnTextActive]}>A-Z</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sortBtn, sortMode === 'distance' && styles.sortBtnActive]}
                  onPress={() => setSortMode('distance')}
                >
                  <Text style={[styles.sortBtnText, sortMode === 'distance' && styles.sortBtnTextActive]}>Near</Text>
                </TouchableOpacity>
              </View>
            </View>
            {online.map(renderMember)}
          </>
        )}
        {offline.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: Spacing.md }]}>LAST SEEN</Text>
            {offline.map(renderMember)}
          </>
        )}
        {members.length === 0 && !selfMember && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>?</Text>
            <Text style={styles.emptyTitle}>No crew yet</Text>
            <Text style={styles.emptySubtitle}>
              They'll appear when they connect to the mesh
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={colorPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setColorPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setColorPickerVisible(false)}
        >
          <View style={styles.colorPicker}>
            <Text style={styles.colorPickerTitle}>Pick your pin color</Text>
            <View style={styles.swatchRow}>
              {CREW_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.swatch, { backgroundColor: c }, myColor === c && styles.swatchSelected]}
                  onPress={() => handleColorPick(c)}
                />
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: 32 },
  sectionLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sortToggle: { flexDirection: 'row', gap: 2 },
  sortBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
  },
  sortBtnActive: { backgroundColor: Colors.primary },
  sortBtnText: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: '700' },
  sortBtnTextActive: { color: '#fff' },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardLowBattery: {
    borderColor: Colors.error + '44',
    backgroundColor: Colors.error + '08',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    position: 'relative',
    borderWidth: 2,
    borderColor: '#2a2a3a',
  },
  avatarOnline: { borderColor: Colors.success },
  avatarText: { color: Colors.textPrimary, fontWeight: '700', fontSize: FontSize.sm },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  info: { flex: 1 },
  name: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '600' },
  meta: { flexDirection: 'row', marginTop: 4, flexWrap: 'wrap' },
  metaText: { color: Colors.textSecondary, fontSize: FontSize.xs },
  lowBatteryText: { color: Colors.error, fontSize: FontSize.xs, marginTop: 4, fontWeight: '600' },
  watchingText: { color: Colors.primary, fontSize: FontSize.xs, marginTop: 4, fontWeight: '600' },
  rightCol: { alignItems: 'flex-end', gap: 6, minWidth: 46 },
  battery: { alignItems: 'flex-end' },
  batteryPct: { fontSize: FontSize.xs, fontWeight: '700', marginBottom: 4 },
  batteryTrack: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
    overflow: 'hidden',
  },
  batteryFill: { height: '100%', borderRadius: 3 },
  signalRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  signalBar: { width: 3, borderRadius: 1 },
  youCard: {
    borderColor: Colors.border,
  },
  colorButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
  },
  colorButtonText: { color: '#fff', fontSize: FontSize.xs, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorPicker: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  colorPickerTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.sm },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: { borderColor: '#fff', borderWidth: 3 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, color: Colors.textMuted, marginBottom: Spacing.md, fontWeight: '700' },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
});
