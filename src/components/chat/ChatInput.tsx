import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Platform, Keyboard } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { hapticLight } from '../../utils/haptics';

interface Props {
  onSend: (text: string) => void;
  onQuickAction: () => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, onQuickAction, disabled }: Props) {
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    hapticLight();
    onSend(trimmed);
    setText('');
  }

  function handleDismissKeyboard() {
    hapticLight();
    Keyboard.dismiss();
  }

  return (
    <View style={styles.container}>
      {isFocused && (
        <TouchableOpacity
          style={styles.dismissBtn}
          onPress={handleDismissKeyboard}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Hide keyboard"
        >
          <Text style={styles.dismissBtnText}>⌄</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.quickBtn}
        onPress={onQuickAction}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.quickBtnText}>＋</Text>
      </TouchableOpacity>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={disabled ? 'Reconnecting…' : 'Message your crew…'}
        placeholderTextColor={Colors.textMuted}
        multiline
        maxLength={200}
        returnKeyType="send"
        blurOnSubmit={false}
        onSubmitEditing={handleSend}
        editable={!disabled}
        keyboardAppearance="dark"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      />

      <TouchableOpacity
        style={[styles.sendBtn, (!text.trim() || disabled) && styles.sendBtnDisabled]}
        onPress={handleSend}
        disabled={!text.trim() || disabled}
      >
        <Text style={styles.sendBtnText}>↑</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 8,
  },
  quickBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primary + '44',
    marginBottom: 1,
  },
  dismissBtn: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  dismissBtnText: {
    color: Colors.textSecondary,
    fontSize: 28,
    lineHeight: 28,
    fontWeight: '700',
  },
  quickBtnText: {
    color: Colors.primary,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.textMuted,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
});
