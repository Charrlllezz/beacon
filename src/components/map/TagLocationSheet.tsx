import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import type { TagCategory, TagScope } from '../../types/festival';

const CATEGORIES: { key: TagCategory; label: string; icon: string }[] = [
  { key: 'stage', label: 'Stage', icon: '🎵' },
  { key: 'food', label: 'Food', icon: '🍔' },
  { key: 'water', label: 'Water', icon: '💧' },
  { key: 'restroom', label: 'Restroom', icon: '🚻' },
  { key: 'camp', label: 'Camp', icon: '⛺' },
  { key: 'custom', label: 'Other', icon: '📌' },
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
            <Text style={styles.categoryIcon}>{cat.icon}</Text>
            <Text style={[styles.categoryText, category === cat.key && styles.categoryTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          onPress={() => canSubmit && onSubmit(name.trim(), category, scope)}
          disabled={!canSubmit}
        >
          <Text style={styles.submitText}>Tag & Share</Text>
        </TouchableOpacity>
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
    borderTopWidth: 1,
    borderColor: Colors.primary + '33',
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
    fontSize: FontSize.lg,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  coords: {
    fontSize: FontSize.xs,
    color: Colors.coordinate,
    fontFamily: 'monospace',
    marginBottom: Spacing.md,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  categoryLabel: {
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
    gap: 4,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '22',
  },
  categoryIcon: { fontSize: 14 },
  categoryText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
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
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelText: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '600' },
  submitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  submitBtnDisabled: { backgroundColor: Colors.textMuted },
  submitText: { color: '#fff', fontSize: FontSize.md, fontWeight: '700' },
});
