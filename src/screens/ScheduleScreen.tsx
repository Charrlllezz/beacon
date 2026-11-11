import React, { useState, useMemo } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing, FontSize, BorderRadius, Fonts, Gradients } from '../config/theme';
import Icon from '../components/ui/Icon';
import GradientButton from '../components/ui/GradientButton';
import { glassCard } from '../components/ui/Glass';
import { festivalConfig } from '../services/festival/FestivalConfig';
import { useNow } from '../utils/useNow';
import { DEMO, DEMO_LINEUP_DAY, lineupNow } from '../config/demo';
import { useScheduleStore } from '../store/useScheduleStore';
import { useDeviceStore } from '../store/useDeviceStore';
import { useCrewStore } from '../store/useCrewStore';
import { useMessagesStore } from '../store/useMessagesStore';
import { bleService } from '../services/ble/BleManager';
import { buildGoingMessage, buildNotGoingMessage, parseMessage } from '../services/mesh/MessageService';
import RNDVUHeader from '../components/common/RNDVUHeader';
import FirstOpenTip from '../components/common/FirstOpenTip';
import ConnectionBar from '../components/common/ConnectionBar';
import { formatTime } from '../utils/time';
import { festivalDays, festivalDayKey } from '../services/festival/FestivalSelection';
import type { Stage, ScheduleSlot } from '../types/festival';

// Day tabs and slot bucketing come from the active festival config, in the
// FESTIVAL's timezone (not the device's — a traveler whose phone is still on
// home time would otherwise see sets land in the wrong day column).
// festivalDayKey puts late-night sets (before 6am) on the previous day, and
// works across month/year boundaries (Countdown NYE's after-midnight sets).

interface ConflictInfo {
  stageId: string;
  artistId: string;
  stageName: string;
  stageColor: string;
  artistName: string;
  startTime: string;
}

function findConflicts(
  newSlot: ScheduleSlot,
  myGoingPicks: { stageId: string; artistId: string }[]
): ConflictInfo[] {
  const newStart = new Date(newSlot.start).getTime();
  const newEnd = new Date(newSlot.end).getTime();

  return myGoingPicks.flatMap(pick => {
    const stage = festivalConfig.getStage(pick.stageId);
    const slot = stage?.schedule.find(s => s.artistId === pick.artistId);
    if (!slot || !stage) return [];
    const pickStart = new Date(slot.start).getTime();
    const pickEnd = new Date(slot.end).getTime();
    if (newStart < pickEnd && newEnd > pickStart) {
      return [{
        stageId: pick.stageId,
        artistId: pick.artistId,
        stageName: stage.shortName,
        stageColor: stage.color,
        artistName: slot.artistName,
        startTime: slot.start,
      }];
    }
    return [];
  });
}

export default function ScheduleScreen() {
  const [selectedDay, setSelectedDay] = useState(DEMO ? DEMO_LINEUP_DAY : 0); // default Fri
  const [pendingPick, setPendingPick] = useState<{ stage: Stage; slot: ScheduleSlot } | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [keptBothKeys, setKeptBothKeys] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [myScheduleOnly, setMyScheduleOnly] = useState(false);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);

  const config = festivalConfig.getConfig();
  const FESTIVAL_TZ = config.festival.timezone;
  const days = useMemo(() => festivalDays(config), [config]);
  const stages = festivalConfig.getAllStages();

  const toggleStageFilter = (stageId: string) => {
    setActiveStageId(prev => prev === stageId ? null : stageId);
  };
  const { toggleMyGoing, isMyGoing: checkMyGoing, getGoingForArtist, removeGoingEntry, myGoingPicks } = useScheduleStore();
  const { myNodeNum } = useDeviceStore();
  const crewMembers = useCrewStore(s => s.crewMembers);
  const addMessage = useMessagesStore(s => s.addMessage);

  const myName = myNodeNum ? (crewMembers[myNodeNum]?.longName ?? 'You') : 'You';
  const dayConfig = days[selectedDay] ?? days[0];

  async function commitGoing(stage: Stage, slot: ScheduleSlot) {
    if (!myNodeNum) {
      Alert.alert('Not Ready', 'Still connecting to your device — try again in a moment.');
      return;
    }
    toggleMyGoing(stage.id, slot.artistId);
    const text = buildGoingMessage(stage.id, slot.artistId);
    const selfId = `self-going-${Date.now()}`;
    const msg = parseMessage(text, myNodeNum, myName, Date.now(), 0);
    addMessage({ ...msg, id: selfId, sendStatus: 'sending' });
    useScheduleStore.getState().addGoingEntry({
      nodeId: myNodeNum,
      nodeName: myName,
      stageId: stage.id,
      artistId: slot.artistId,
      timestamp: Date.now(),
    });
    try {
      await bleService.sendText(text);
      useMessagesStore.getState().setSendStatus(selfId, 'sent');
    } catch (e) {
      console.warn('going broadcast failed:', e);
      useMessagesStore.getState().setSendStatus(selfId, 'failed');
      Alert.alert('Broadcast Failed', "Your pick is saved locally but couldn't be sent to your crew. Check your device connection.");
    }
  }

  async function broadcastNotGoing(stageId: string, artistId: string) {
    // Best-effort un-going broadcast so peers drop the stale RSVP. Fire-and-
    // forget like all broadcasts; local state was already updated by the caller.
    try {
      await bleService.sendText(buildNotGoingMessage(stageId, artistId));
    } catch (e) {
      console.warn('un-going broadcast failed:', e);
    }
  }

  async function handleGoing(stage: Stage, slot: ScheduleSlot) {
    // Tapping a pick that's already selected → deselect and clear any conflict tag
    if (checkMyGoing(stage.id, slot.artistId)) {
      toggleMyGoing(stage.id, slot.artistId);
      removeGoingEntry(myNodeNum ?? 0, stage.id, slot.artistId);
      broadcastNotGoing(stage.id, slot.artistId);
      const key = `${stage.id}:${slot.artistId}`;
      setKeptBothKeys(prev => { const next = new Set(prev); next.delete(key); return next; });
      return;
    }

    const found = findConflicts(slot, myGoingPicks);
    if (found.length > 0) {
      setPendingPick({ stage, slot });
      setConflicts(found);
    } else {
      await commitGoing(stage, slot);
    }
  }

  // Picks are shared from your radio; check before changing anything, or
  // Replace removed the old pick and then failed to add the new one.
  function radioReady(): boolean {
    if (myNodeNum) return true;
    Alert.alert('Not Ready', 'Still connecting to your device — try again in a moment.');
    return false;
  }

  async function handleKeepBoth() {
    if (!pendingPick || !radioReady()) return;
    await commitGoing(pendingPick.stage, pendingPick.slot);
    // Mark the new pick and all its conflicts as "kept both"
    const newKey = `${pendingPick.stage.id}:${pendingPick.slot.artistId}`;
    const conflictKeys = conflicts.map(c => `${c.stageId}:${c.artistId}`);
    setKeptBothKeys(prev => new Set([...prev, newKey, ...conflictKeys]));
    setPendingPick(null);
    setConflicts([]);
  }

  async function handleReplace() {
    if (!pendingPick || !radioReady()) return;
    const myId = myNodeNum ?? 0;
    // Remove all conflicting picks first
    for (const conflict of conflicts) {
      if (checkMyGoing(conflict.stageId, conflict.artistId)) {
        toggleMyGoing(conflict.stageId, conflict.artistId);
      }
      // Also remove going entries so the party icon clears, and tell peers.
      removeGoingEntry(myId, conflict.stageId, conflict.artistId);
      broadcastNotGoing(conflict.stageId, conflict.artistId);
      // Clean up kept-both tags for replaced conflicts
      const key = `${conflict.stageId}:${conflict.artistId}`;
      setKeptBothKeys(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
    await commitGoing(pendingPick.stage, pendingPick.slot);
    setPendingPick(null);
    setConflicts([]);
  }

  function handleCancel() {
    setPendingPick(null);
    setConflicts([]);
  }

  const query = searchQuery.toLowerCase().trim();
  // Ticks, so LIVE and finished sets update while you're looking at the tab.
  const now = lineupNow(useNow());

  const filteredStageData = useMemo(() => {
    return stages
      .filter(stage => !activeStageId || activeStageId === stage.id || query)
      .map(stage => {
        let slots = stage.schedule
          .filter(s => dayConfig !== undefined && festivalDayKey(s.start, FESTIVAL_TZ) === dayConfig.key)
          .filter(s => new Date(s.end).getTime() > now)
          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
        if (query) {
          slots = slots.filter(s => s.artistName.toLowerCase().includes(query));
        }
        if (myScheduleOnly) {
          slots = slots.filter(s => checkMyGoing(stage.id, s.artistId));
        }
        return { stage, slots };
      })
      .filter(({ slots }) => slots.length > 0);
  }, [stages, dayConfig?.key, FESTIVAL_TZ, query, myScheduleOnly, activeStageId, myGoingPicks, now]);

  return (
    <SafeAreaView style={styles.container}>
      <RNDVUHeader title="Lineup" subtitle={config.festival.shortName} />
      <ConnectionBar />

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <View style={styles.searchIcon}><Icon name="magnifyingglass" size={15} color={Colors.textMuted} /></View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search artists…"
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" style={styles.searchClear}>
              <Icon name="xmark.circle.fill" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.myScheduleBtn, myScheduleOnly && styles.myScheduleBtnActive]}
          onPress={() => setMyScheduleOnly(v => !v)}
        >
          <Icon name="star" filled={myScheduleOnly} size={13} color={myScheduleOnly ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.myScheduleBtnText, myScheduleOnly && styles.myScheduleBtnTextActive]}>
            My Sets
          </Text>
        </TouchableOpacity>
      </View>

      {/* Day selector */}
      <View style={styles.daySelector}>
        {days.map((day, i) => (
          <TouchableOpacity
            key={day.key}
            style={[styles.dayTab, selectedDay === i && styles.dayTabActive]}
            onPress={() => setSelectedDay(i)}
          >
            <Text style={[styles.dayTabText, selectedDay === i && styles.dayTabTextActive]}>
              {day.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stage filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stageFilterWrap} contentContainerStyle={styles.stageFilterRow}>
        {stages.map(stage => {
          const isActive = activeStageId === stage.id;
          return (
            <TouchableOpacity
              key={stage.id}
              style={[styles.stageChip, isActive && { backgroundColor: stage.color + '33', borderColor: stage.color }]}
              onPress={() => toggleStageFilter(stage.id)}
            >
              <View style={[styles.stageChipDot, { backgroundColor: stage.color }]} />
              <Text style={[styles.stageChipText, isActive && { color: stage.color }]}>
                {stage.shortName}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {filteredStageData.length === 0 && (
          <View style={styles.emptyFilter}>
            <Text style={styles.emptyFilterText}>
              {stages.length === 0
                ? `The ${config.festival.shortName} lineup isn't in the app yet.`
                : myScheduleOnly ? 'No sets marked "Going" for this day' : 'No matching artists'}
            </Text>
          </View>
        )}
        {filteredStageData.map(({ stage, slots }) => {

          const nowPlaying = festivalConfig.getNowPlaying(stage.id, new Date(now));
          return (
            <View key={stage.id} style={styles.stageCard}>
              <View style={[styles.stageAccent, { backgroundColor: stage.color }]} />
              <View style={styles.stageHeader}>
                <View style={[styles.colorDot, { backgroundColor: stage.color }]} />
                <Text style={styles.stageName}>{stage.name}</Text>
                {nowPlaying && (
                  <LinearGradient colors={Gradients.sunset} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.liveBadge}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveBadgeText}>LIVE</Text>
                  </LinearGradient>
                )}
              </View>

              {slots.map(slot => {
                const isNow = nowPlaying?.artistId === slot.artistId;
                const isMyGoing = checkMyGoing(stage.id, slot.artistId);
                const goingCrew = getGoingForArtist(stage.id, slot.artistId);
                const isKeptBothConflict = keptBothKeys.has(`${stage.id}:${slot.artistId}`);

                return (
                  <View
                    key={slot.artistId}
                    style={[styles.artistRow, isNow && styles.artistRowNow]}
                  >
                    <View style={styles.artistInfo}>
                      <View style={styles.artistMeta}>
                        <Text style={styles.artistTime}>{formatTime(slot.start, FESTIVAL_TZ)} – {formatTime(slot.end, FESTIVAL_TZ)}</Text>
                        {isNow && <Text style={styles.nowLabel}> · NOW</Text>}
                        {isKeptBothConflict && <Text style={styles.conflictLabel}> · CONFLICT</Text>}
                      </View>
                      <Text style={[styles.artistName, isNow && styles.artistNameNow]}>
                        {slot.artistName}
                      </Text>
                      {goingCrew.length > 0 && (
                        <View style={styles.goingCrewRow}>
                          <Icon name="person.2.fill" size={12} color={Colors.pink} />
                          <Text style={styles.goingCrewText}>
                            {goingCrew.map(g => g.nodeName).join(', ')} going
                          </Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[styles.goingBtn, isMyGoing && styles.goingBtnActive]}
                      onPress={() => handleGoing(stage, slot)}
                      accessibilityLabel={isMyGoing ? 'Going' : "I'm Going"}
                    >
                      {isMyGoing && (
                        <LinearGradient colors={Gradients.sunset} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
                      )}
                      {isMyGoing && <Icon name="checkmark" size={11} color="#fff" weight="bold" />}
                      <Text style={[styles.goingBtnText, isMyGoing && styles.goingBtnTextActive]}>
                        {isMyGoing ? 'Going' : "I'm Going"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <FirstOpenTip
        storageKey="rndvu_tip_lineup"
        title="Festival Lineup"
        tips={[
          { icon: 'checkmark.circle', title: 'Mark Your Sets', description: "Tap 'I'm Going' on sets you don't want to miss" },
          { icon: 'person.2', title: 'Crew Picks', description: 'See which sets your crew is going to with the party icon' },
          { icon: 'exclamationmark.triangle', title: 'Conflicts', description: "We'll let you know when your picks overlap so you can decide" },
        ]}
      />

      {/* Conflict modal */}
      <Modal
        visible={pendingPick !== null}
        transparent
        animationType="fade"
        onRequestClose={handleCancel}
      >
        <Pressable style={styles.modalOverlay} onPress={handleCancel} accessible={false}>
          <Pressable
            style={styles.modalCard}
            onPress={() => {}}
            accessible={false}
            accessibilityViewIsModal
            onAccessibilityEscape={handleCancel}
          >
            <Text style={styles.modalTitle}>Scheduling Conflict</Text>
            <Text style={styles.modalSubtitle}>
              {pendingPick?.slot.artistName} overlaps with:
            </Text>

            {conflicts.map(c => (
              <View key={`${c.stageId}-${c.artistId}`} style={styles.conflictItem}>
                <View style={[styles.conflictDot, { backgroundColor: c.stageColor }]} />
                <View>
                  <Text style={styles.conflictArtist}>{c.artistName}</Text>
                  <Text style={styles.conflictMeta}>{c.stageName} · {formatTime(c.startTime, FESTIVAL_TZ)}</Text>
                </View>
              </View>
            ))}

            <View style={styles.modalActions}>
              <GradientButton compact style={styles.modalBtn} variant="ghost" label="Cancel" onPress={handleCancel} />
              <GradientButton compact style={styles.modalBtn} variant="ghost" label="Keep Both" onPress={handleKeepBoth} />
              <GradientButton compact style={styles.modalBtn} label="Replace" onPress={handleReplace} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  // Search & filters
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    height: 40,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    paddingVertical: 0,
  },
  searchClear: { paddingHorizontal: 4 },
  myScheduleBtn: {
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    height: 40,
  },
  myScheduleBtnActive: { backgroundColor: Colors.primary + '2e', borderColor: Colors.primary + '88' },
  myScheduleBtnText: { color: Colors.textSecondary, fontFamily: Fonts.rounded, fontSize: FontSize.xs + 1, fontWeight: '700' },
  myScheduleBtnTextActive: { color: Colors.primary },
  stageFilterWrap: {
    height: 42,
    marginTop: Spacing.sm,
  },
  stageFilterRow: {
    paddingHorizontal: Spacing.md,
    gap: 6,
    alignItems: 'center',
    height: 42,
  },
  stageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 34,
    borderRadius: BorderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    gap: 6,
  },
  stageChipDot: { width: 8, height: 8, borderRadius: 4 },
  stageChipText: { color: Colors.textSecondary, fontFamily: Fonts.rounded, fontSize: FontSize.sm, fontWeight: '700' },
  emptyFilter: { alignItems: 'center', paddingTop: 60 },
  emptyFilterText: { color: Colors.textMuted, fontSize: FontSize.sm },
  daySelector: {
    flexDirection: 'row',
    padding: Spacing.md,
    paddingTop: Spacing.sm,
    gap: 6,
  },
  dayTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
  dayTabActive: { backgroundColor: Colors.primary + '2e', borderColor: Colors.primary + '88' },
  dayTabText: { color: Colors.textSecondary, fontFamily: Fonts.rounded, fontSize: FontSize.md, fontWeight: '700' },
  dayTabTextActive: { color: Colors.primary },
  content: { padding: Spacing.md, paddingBottom: 32 },
  stageCard: {
    ...glassCard,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  // Stage colour accent down the card's left edge.
  stageAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  colorDot: { width: 10, height: 10, borderRadius: 5, marginRight: Spacing.sm },
  stageName: { fontFamily: Fonts.rounded, fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary, flex: 1 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveBadgeText: { color: '#fff', fontFamily: Fonts.rounded, fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  artistRowNow: { backgroundColor: Colors.primary + '14' },
  artistInfo: { flex: 1 },
  artistMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  artistTime: { color: Colors.textSecondary, fontFamily: Fonts.rounded, fontSize: FontSize.xs + 1, fontWeight: '600', fontVariant: ['tabular-nums'] },
  nowLabel: { color: Colors.primary, fontFamily: Fonts.rounded, fontSize: FontSize.xs + 1, fontWeight: '800' },
  conflictLabel: { color: Colors.warning, fontFamily: Fonts.rounded, fontSize: FontSize.xs + 1, fontWeight: '800' },
  artistName: { color: Colors.textPrimary, fontSize: FontSize.md + 1, fontWeight: '600' },
  artistNameNow: { fontWeight: '800' },
  goingCrewRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  goingCrewText: { color: Colors.textSecondary, fontSize: FontSize.xs + 1 },
  goingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.primary + '99',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    marginLeft: Spacing.sm,
    overflow: 'hidden',
  },
  goingBtnActive: { borderColor: 'transparent' },
  goingBtnText: { color: Colors.primary, fontFamily: Fonts.rounded, fontSize: FontSize.xs + 1, fontWeight: '800' },
  goingBtnTextActive: { color: '#fff' },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
    paddingBottom: 40,
    paddingHorizontal: Spacing.md,
  },
  modalCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.warning + '55',
  },
  modalTitle: {
    color: Colors.warning,
    fontFamily: Fonts.rounded,
    fontSize: FontSize.xl,
    fontWeight: '800',
    marginBottom: 6,
  },
  modalSubtitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    marginBottom: Spacing.md,
  },
  conflictItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  conflictDot: { width: 10, height: 10, borderRadius: 5 },
  conflictArtist: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '700' },
  conflictMeta: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 2 },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  modalBtn: { flex: 1 },
});
