import React, { useState, useMemo } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '../config/theme';
import { festivalConfig } from '../services/festival/FestivalConfig';
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
import type { Stage, ScheduleSlot } from '../types/festival';

// Festival days: Fri Apr 17 – Sun Apr 19, 2026 (UTC-7)
const FESTIVAL_DAYS = [
  { label: 'Fri', date: 17 },
  { label: 'Sat', date: 18 },
  { label: 'Sun', date: 19 },
];

// Bucket slots by the FESTIVAL's calendar day/hour, not the device's — a
// traveler whose phone is still on home time would otherwise see sets land in
// the wrong day column.
const FESTIVAL_TZ = festivalConfig.getConfig().festival.timezone;

function festivalDateParts(iso: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FESTIVAL_TZ, day: 'numeric', hour: 'numeric', hour12: false,
  }).formatToParts(new Date(iso));
  const day = Number(parts.find(p => p.type === 'day')?.value ?? '0');
  let hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  if (hour === 24) hour = 0; // some engines emit '24' for midnight under hour12:false
  return { day, hour };
}

function slotMatchesDay(slot: ScheduleSlot, dayOfMonth: number): boolean {
  // Late-night sets (before 6am festival-local) belong to the previous day.
  const { day, hour } = festivalDateParts(slot.start);
  return day === dayOfMonth || (hour < 6 && day === dayOfMonth + 1);
}

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
  const [selectedDay, setSelectedDay] = useState(0); // default Fri
  const [pendingPick, setPendingPick] = useState<{ stage: Stage; slot: ScheduleSlot } | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [keptBothKeys, setKeptBothKeys] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [myScheduleOnly, setMyScheduleOnly] = useState(false);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);

  const stages = festivalConfig.getAllStages();

  const toggleStageFilter = (stageId: string) => {
    setActiveStageId(prev => prev === stageId ? null : stageId);
  };
  const { toggleMyGoing, isMyGoing: checkMyGoing, getGoingForArtist, removeGoingEntry, myGoingPicks } = useScheduleStore();
  const { myNodeNum } = useDeviceStore();
  const crewMembers = useCrewStore(s => s.crewMembers);
  const addMessage = useMessagesStore(s => s.addMessage);

  const myName = myNodeNum ? (crewMembers[myNodeNum]?.longName ?? 'You') : 'You';
  const dayConfig = FESTIVAL_DAYS[selectedDay];

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

  async function handleKeepBoth() {
    if (!pendingPick) return;
    await commitGoing(pendingPick.stage, pendingPick.slot);
    // Mark the new pick and all its conflicts as "kept both"
    const newKey = `${pendingPick.stage.id}:${pendingPick.slot.artistId}`;
    const conflictKeys = conflicts.map(c => `${c.stageId}:${c.artistId}`);
    setKeptBothKeys(prev => new Set([...prev, newKey, ...conflictKeys]));
    setPendingPick(null);
    setConflicts([]);
  }

  async function handleReplace() {
    if (!pendingPick) return;
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
  const now = Date.now();

  const filteredStageData = useMemo(() => {
    return stages
      .filter(stage => !activeStageId || activeStageId === stage.id || query)
      .map(stage => {
        let slots = stage.schedule
          .filter(s => slotMatchesDay(s, dayConfig.date))
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
  }, [stages, dayConfig.date, query, myScheduleOnly, activeStageId, myGoingPicks, now]);

  return (
    <SafeAreaView style={styles.container}>
      <RNDVUHeader title="Lineup" subtitle="Coachella W2" />
      <ConnectionBar />

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
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
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.myScheduleBtn, myScheduleOnly && styles.myScheduleBtnActive]}
          onPress={() => setMyScheduleOnly(v => !v)}
        >
          <Text style={[styles.myScheduleBtnText, myScheduleOnly && styles.myScheduleBtnTextActive]}>
            My Sets
          </Text>
        </TouchableOpacity>
      </View>

      {/* Day selector */}
      <View style={styles.daySelector}>
        {FESTIVAL_DAYS.map((day, i) => (
          <TouchableOpacity
            key={day.label}
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
              {myScheduleOnly ? 'No sets marked "Going" for this day' : 'No matching artists'}
            </Text>
          </View>
        )}
        {filteredStageData.map(({ stage, slots }) => {

          const nowPlaying = festivalConfig.getNowPlaying(stage.id);
          return (
            <View key={stage.id} style={styles.stageCard}>
              <View style={styles.stageHeader}>
                <View style={[styles.colorDot, { backgroundColor: stage.color }]} />
                <Text style={styles.stageName}>{stage.name}</Text>
                {nowPlaying && (
                  <View style={styles.liveBadge}>
                    <Text style={styles.liveBadgeText}>● LIVE</Text>
                  </View>
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
                        <Text style={styles.goingCrewText}>
                          🎉 {goingCrew.map(g => g.nodeName).join(', ')} going
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[styles.goingBtn, isMyGoing && styles.goingBtnActive]}
                      onPress={() => handleGoing(stage, slot)}
                    >
                      <Text style={[styles.goingBtnText, isMyGoing && styles.goingBtnTextActive]}>
                        {isMyGoing ? '✓ Going' : "I'm Going"}
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
          { icon: '✅', title: 'Mark Your Sets', description: "Tap 'I'm Going' on sets you don't want to miss" },
          { icon: '👥', title: 'Crew Picks', description: 'See which sets your crew is going to with the party icon' },
          { icon: '⚠️', title: 'Conflicts', description: "We'll let you know when your picks overlap so you can decide" },
        ]}
      />

      {/* Conflict modal */}
      <Modal
        visible={pendingPick !== null}
        transparent
        animationType="fade"
        onRequestClose={handleCancel}
      >
        <Pressable style={styles.modalOverlay} onPress={handleCancel}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
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
              <TouchableOpacity style={styles.btnCancel} onPress={handleCancel}>
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnKeepBoth} onPress={handleKeepBoth}>
                <Text style={styles.btnKeepBothText}>Keep Both</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnReplace} onPress={handleReplace}>
                <Text style={styles.btnReplaceText}>Replace</Text>
              </TouchableOpacity>
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
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    height: 38,
  },
  searchIcon: { fontSize: 14, marginRight: 6 },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    paddingVertical: 0,
  },
  searchClear: { color: Colors.textMuted, fontSize: 14, paddingHorizontal: 4 },
  myScheduleBtn: {
    paddingHorizontal: 14,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    height: 38,
  },
  myScheduleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  myScheduleBtnText: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: '700' },
  myScheduleBtnTextActive: { color: '#fff' },
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 5,
  },
  stageChipDot: { width: 8, height: 8, borderRadius: 4 },
  stageChipText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },
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
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  dayTabActive: { backgroundColor: Colors.primary },
  dayTabText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },
  dayTabTextActive: { color: '#fff' },
  content: { padding: Spacing.md, paddingBottom: 32 },
  stageCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: '#1e1d2a',
    overflow: 'hidden',
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1d2a',
  },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginRight: Spacing.sm },
  stageName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary, flex: 1 },
  liveBadge: {
    backgroundColor: Colors.error + '22',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  liveBadgeText: { color: Colors.error, fontSize: 10, fontWeight: '800' },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#0f0f1a',
  },
  artistRowNow: { backgroundColor: Colors.primary + '11' },
  artistInfo: { flex: 1 },
  artistMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  artistTime: { color: Colors.textSecondary, fontSize: FontSize.xs },
  nowLabel: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '700' },
  conflictLabel: { color: Colors.warning, fontSize: FontSize.xs, fontWeight: '700' },
  artistName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '600' },
  artistNameNow: { fontWeight: '800' },
  goingCrewText: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 4 },
  goingBtn: {
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    marginLeft: Spacing.sm,
  },
  goingBtnActive: { backgroundColor: Colors.primary },
  goingBtnText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '700' },
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
    borderWidth: 1,
    borderColor: Colors.warning + '44',
  },
  modalTitle: {
    color: Colors.warning,
    fontSize: FontSize.lg,
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
    backgroundColor: Colors.surface,
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
  btnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnCancelText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '700' },
  btnKeepBoth: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  btnKeepBothText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },
  btnReplace: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  btnReplaceText: { color: '#fff', fontSize: FontSize.sm, fontWeight: '700' },
});
