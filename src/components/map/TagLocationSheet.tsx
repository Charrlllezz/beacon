import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius, Fonts } from '../../config/theme';
import type { TagCategory, TagScope } from '../../types/festival';
import Icon from '../ui/Icon';
import GradientButton from '../ui/GradientButton';
import { TAG_CATEGORY_ICONS } from './tagCategories';

const CATEGORIES: { key: TagCategory; label: string }[] = [
  { key: 'stage', label: 'Stage' },
  { key: 'food', label: 'Food' },
  { key: 'water', label: 'Water' },
  { key: 'restroom', label: 'Restroom' },
  { key: 'camp', label: 'Camp' },
  { key: 'custom', label: 'Other' },
];

interface Props {
  coordinate: { latitude: number; longitude: number };
  onSubmit: (name: string, category: TagCategory, scope: TagScope) => void;
  onCancel: () => void;
}

export default function TagLocationSheet({ coordinate, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TagCategory>('custom');
  // Scope is hardcoded 'crew' until Model 2 provisions a second channel for
  // community tags — channel 1 isn't set up yet, so the 'community' option
  // was silently broadcasting to a disabled slot.
  const scope: TagScope = 'crew';

  const canSubmit = name.trim().length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.handle} />
      <Text style={styles.title}>Tag This Spot</Text>
      <Text style={styles.coords}>
        {coordinate.latitude.toFixed(4)}, {coordinate.longitude.toFixed(4)}
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Name this location…"
        placeholderTextColor={Colors.textMuted}
        value={name}
        onChangeText={setName}
        maxLength={30}
        autoFocus
        keyboardAppearance="dark"
      />

      <Text style={styles.categoryLabel}>Category</Text>
      <View style={styles.categoryRow}>
        {CATEGORIES.map(cat => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.categoryChip, category === cat.key && styles.categoryChipActive]}
            onPress={() => setCategory(cat.key)}
          >
            <Icon name={TAG_CATEGORY_ICONS[cat.key]} size={14} color={category === cat.key ? Colors.primary : Colors.textSecondary} />
            <Text style={[styles.categoryText, category === cat.key && styles.categoryTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.actions}>
        <GradientButton style={styles.actionBtn} variant="ghost" label="Cancel" onPress={onCancel} />
        <GradientButton
          style={styles.actionBtn}
          label="Tag & Share"
          icon="paperplane.fill"
          onPress={() => { if (canSubmit) onSubmit(name.trim(), category, scope); }}
          disabled={!canSubmit}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.lg,
    paddingBottom: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.textMuted,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: FontSize.xl,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  coords: {
    fontSize: FontSize.xs,
    color: Colors.coordinate,
    fontFamily: 'ui-monospace',
    marginBottom: Spacing.md,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    marginBottom: Spacing.md,
  },
  categoryLabel: {
    fontFamily: Fonts.rounded,
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: Spacing.lg,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: BorderRadius.full,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
  categoryChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '22',
  },
  categoryText: { fontFamily: Fonts.rounded, fontSize: FontSize.xs + 1, fontWeight: '700', color: Colors.textSecondary },
  categoryTextActive: { color: Colors.primary },
  scopeRow: {
    gap: 8,
    marginBottom: Spacing.lg,
  },
  scopeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scopeBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '11',
  },
  scopeBtnActiveCommunity: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warning + '11',
  },
  scopeIcon: { fontSize: 20 },
  scopeTextWrap: { flex: 1 },
  scopeTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  scopeTitleActive: { color: Colors.primary },
  scopeTitleActiveCommunity: { color: Colors.warning },
  scopeHint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionBtn: { flex: 1 },
});
