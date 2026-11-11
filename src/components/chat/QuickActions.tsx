import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing, FontSize, BorderRadius, Gradients, Fonts } from '../../config/theme';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { hapticLight, hapticWarning } from '../../utils/haptics';
import Icon from '../ui/Icon';

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
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close quick actions"
          testID="chat-quick-actions-close"
        >
          <Icon name="xmark" size={12} color={Colors.textSecondary} weight="bold" />
        </TouchableOpacity>
      </View>

      {/* Festivals without stage data yet (e.g. a new venue) skip this row. */}
      {stages.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Heading to a stage</Text>
          <Text style={styles.sectionHint}>Tap to tell your crew where you're going</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {stages.map(stage => (
              <TouchableOpacity
                key={stage.id}
                style={[styles.chip, { borderColor: stage.color + '55' }]}
                onPress={() => { hapticLight(); onSendHeading(stage.id); }}
              >
                <View style={[styles.chipDot, { backgroundColor: stage.color }]} />
                <Text style={[styles.chipText, { color: stage.color }]}>{stage.shortName}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionButton} onPress={onSendRally} accessibilityRole="button">
          <LinearGradient colors={Gradients.sunset} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.actionIcon}>
            <Icon name="mappin.and.ellipse" size={18} color="#fff" weight="semibold" />
          </LinearGradient>
          <Text style={styles.actionText}>Rally Point</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={() => { hapticLight(); onSetMeetup(); }} accessibilityRole="button">
          <LinearGradient colors={Gradients.sunset} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.actionIcon}>
            <Icon name="clock.fill" size={18} color="#fff" weight="semibold" />
          </LinearGradient>
          <Text style={styles.actionText}>Set Meetup</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.actionButton, styles.sosButton]} onPress={() => { hapticWarning(); onSendSOS(); }} accessibilityRole="button">
          <View style={[styles.actionIcon, { backgroundColor: Colors.error }]}>
            <Icon name="sos" size={20} color="#fff" weight="bold" />
          </View>
          <Text style={[styles.actionText, { color: Colors.error }]}>Need Help</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.glassBorder,
    paddingBottom: 10,
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
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  closeBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontFamily: Fonts.rounded,
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: '700',
    paddingHorizontal: Spacing.md,
    marginBottom: 2,
  },
  sectionHint: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    paddingHorizontal: Spacing.md,
    marginBottom: 8,
  },
  row: {
    paddingLeft: Spacing.md,
    paddingRight: Spacing.md,
    gap: 8,
    marginBottom: Spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: BorderRadius.full,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontFamily: Fonts.rounded, fontSize: FontSize.sm, fontWeight: '700' },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
  sosButton: {
    borderColor: Colors.error + '55',
    backgroundColor: Colors.error + '12',
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontFamily: Fonts.rounded, fontSize: FontSize.xs, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
});
