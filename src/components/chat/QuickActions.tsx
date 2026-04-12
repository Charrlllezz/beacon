import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { hapticLight, hapticWarning } from '../../utils/haptics';

interface Props {
  onSendHeading: (stageId: string) => void;
  onSendRally: () => void;
  onSendSOS: () => void;
  onSetMeetup: () => void;
  onClose: () => void;
}

export default function QuickActions({ onSendHeading, onSendRally, onSendSOS, onSetMeetup, onClose }: Props) {
  const stages = festivalConfig.getAllStages();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Quick Actions</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Heading to a stage</Text>
      <Text style={styles.sectionHint}>Tap to tell your crew where you're going</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {stages.map(stage => (
          <TouchableOpacity
            key={stage.id}
            style={[styles.chip, { borderColor: stage.color + '66' }]}
            onPress={() => { hapticLight(); onSendHeading(stage.id); }}
          >
            <Text style={styles.chipEmoji}>{stage.emoji ?? '⭐'}</Text>
            <Text style={[styles.chipText, { color: stage.color }]}>{stage.shortName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.actionButton, styles.rallyButton]} onPress={onSendRally}>
          <Text style={styles.actionEmoji}>📍</Text>
          <Text style={[styles.actionText, { color: Colors.primary }]}>Rally Point</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionButton, styles.meetupButton]} onPress={() => { hapticLight(); onSetMeetup(); }}>
          <Text style={styles.actionEmoji}>🕐</Text>
          <Text style={[styles.actionText, { color: Colors.warning }]}>Set Meetup</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionButton, styles.sosButton]} onPress={() => { hapticWarning(); onSendSOS(); }}>
          <Text style={styles.actionEmoji}>🆘</Text>
          <Text style={[styles.actionText, { color: Colors.error }]}>Need Help</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerText: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    marginBottom: 2,
  },
  sectionHint: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    paddingHorizontal: Spacing.md,
    marginBottom: 6,
  },
  closeText: { color: Colors.textSecondary, fontSize: 16 },
  row: {
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    gap: 8,
    marginBottom: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.full,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  chipEmoji: { fontSize: 14 },
  chipText: { fontSize: FontSize.sm, fontWeight: '700' },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.sm,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rallyButton: {
    borderColor: Colors.primary + '44',
    backgroundColor: Colors.primary + '11',
  },
  meetupButton: {
    borderColor: Colors.warning + '44',
    backgroundColor: Colors.warning + '11',
  },
  sosButton: {
    borderColor: Colors.error + '44',
    backgroundColor: Colors.error + '11',
  },
  actionEmoji: { fontSize: 22, marginBottom: 4 },
  actionText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
});
