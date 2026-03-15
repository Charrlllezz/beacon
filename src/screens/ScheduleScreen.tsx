import React, { useState } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '../config/theme';
import { festivalConfig } from '../services/festival/FestivalConfig';
import { useScheduleStore } from '../store/useScheduleStore';
import { useDeviceStore } from '../store/useDeviceStore';
import { useCrewStore } from '../store/useCrewStore';
import { useMessagesStore } from '../store/useMessagesStore';
import { bleService } from '../services/ble/BleManager';
import { buildGoingMessage, parseMessage } from '../services/mesh/MessageService';
import BeaconHeader from '../components/common/BeaconHeader';
import ConnectionBar from '../components/common/ConnectionBar';
import { formatTime } from '../utils/time';
import type { Stage, ScheduleSlot } from '../types/festival';

// Festival days: Wed May 20 – Sun May 24, 2026 (UTC-7)
const FESTIVAL_DAYS = [
  { label: 'Wed', date: 20 },
  { label: 'Thu', date: 21 },
  { label: 'Fri', date: 22 },
  { label: 'Sat', date: 23 },
  { label: 'Sun', date: 24 },
];

function slotMatchesDay(slot: ScheduleSlot, dayOfMonth: number): boolean {
  const d = new Date(slot.start);
  const startDay = d.getDate();
  return startDay === dayOfMonth || (d.getHours() < 6 && startDay === dayOfMonth + 1);
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
  const [selectedDay, setSelectedDay] = useState(2); // default Fri
  const [pendingPick, setPendingPick] = useState<{ stage: Stage; slot: ScheduleSlot } | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [keptBothKeys, setKeptBothKeys] = useState<Set<string>>(new Set());

  const stages = festivalConfig.getAllStages();
  const { toggleMyGoing, isMyGoing: checkMyGoing, getGoingForArtist, removeGoingEntry, myGoingPicks } = useScheduleStore();
  const { myNodeNum } = useDeviceStore();
  const crewMembers = useCrewStore(s => s.crewMembers);
  const addMessage = useMessagesStore(s => s.addMessage);

  const myName = myNodeNum ? (crewMembers[myNodeNum]?.longName ?? 'You') : 'You';
  const dayConfig = FESTIVAL_DAYS[selectedDay];

  async function commitGoing(stage: Stage, slot: ScheduleSlot) {
    toggleMyGoing(stage.id, slot.artistId);
    const myId = myNodeNum ?? 0;
    const text = buildGoingMessage(stage.id, slot.artistId);
    const msg = parseMessage(text, myId, myName, Date.now(), 0);
    addMessage({ ...msg, id: `self-going-${Date.now()}` });
    useScheduleStore.getState().addGoingEntry({
      nodeId: myId,
      nodeName: myName,
      stageId: stage.id,
      artistId: slot.artistId,
      timestamp: Date.now(),
    });
    try { await bleService.sendText(text); } catch {}
  }

  async function handleGoing(stage: Stage, slot: ScheduleSlot) {
    // Tapping a pick that's already selected → deselect and clear any conflict tag
    if (checkMyGoing(stage.id, slot.artistId)) {
      toggleMyGoing(stage.id, slot.artistId);
      removeGoingEntry(myNodeNum ?? 0, stage.id, slot.artistId);
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
    // Remove all conflicting picks first
    for (const conflict of conflicts) {
      if (checkMyGoing(conflict.stageId, conflict.artistId)) {
        toggleMyGoing(conflict.stageId, conflict.artistId);
      }
    }
    await commitGoing(pendingPick.stage, pendingPick.slot);
    setPendingPick(null);
    setConflicts([]);
  }

  function handleCancel() {
    setPendingPick(null);
    setConflicts([]);
  }

  return (
    <SafeAreaView style={styles.container}>
      <BeaconHeader title="Lineup" subtitle="LiB 2026" />
      <ConnectionBar />

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

      <ScrollView contentContainerStyle={styles.content}>
        {stages.map(stage => {
          const slots = stage.schedule
            .filter(s => slotMatchesDay(s, dayConfig.date))
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
          if (!slots.length) return null;

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
                        <Text style={styles.artistTime}>{formatTime(slot.start)} – {formatTime(slot.end)}</Text>
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
                  <Text style={styles.conflictMeta}>{c.stageName} · {formatTime(c.startTime)}</Text>
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
