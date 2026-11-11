import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Platform, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Spacing, FontSize, Gradients, Fonts } from '../../config/theme';
import { hapticLight } from '../../utils/haptics';
import { MAX_MESSAGE_BYTES, bytesLeft, utf8Length } from '../../utils/textBytes';
import Icon from '../ui/Icon';

interface Props {
  // false: not taken (e.g. radio not ready), so keep the text.
  onSend: (text: string) => boolean | void;
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
    if (onSend(trimmed) !== false) setText('');
  }

  function handleChange(next: string) {
    // Refuse input past what the radio can carry (bytes, see textBytes.ts).
    if (utf8Length(next) > MAX_MESSAGE_BYTES && next.length > text.length) return;
    setText(next);
  }

  const left = bytesLeft(text);
  const canSend = !!text.trim() && !disabled;

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
          <Icon name="chevron.down" size={18} color={Colors.textSecondary} weight="semibold" />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.quickBtn}
        onPress={() => { hapticLight(); onQuickAction(); }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Quick actions"
        testID="chat-quick-actions"
      >
        <Icon name="plus" size={20} color={Colors.primary} weight="semibold" />
      </TouchableOpacity>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={handleChange}
        placeholder={disabled ? 'Reconnecting…' : 'Message your crew…'}
        placeholderTextColor={Colors.textMuted}
        multiline
        returnKeyType="send"
        // Return sends. With multiline, blurOnSubmit={false} meant "newline",
        // so the keyboard's Send key never sent.
        submitBehavior="submit"
        onSubmitEditing={handleSend}
        editable={!disabled}
        keyboardAppearance="dark"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      />

      {left !== null && (
        <Text style={[styles.counter, left <= 0 && styles.counterFull]}>{Math.max(left, 0)}</Text>
      )}

      <TouchableOpacity
        style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
        onPress={handleSend}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        testID="chat-send"
      >
        {canSend && (
          <LinearGradient colors={Gradients.sunset} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        )}
        <Icon name="arrow.up" size={18} color={canSend ? '#fff' : Colors.textMuted} weight="bold" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  counter: { fontFamily: Fonts.rounded, color: Colors.textSecondary, fontSize: FontSize.xs, marginHorizontal: Spacing.xs, alignSelf: 'center', fontVariant: ['tabular-nums'] },
  counterFull: { color: Colors.warning },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.glassBorder,
    backgroundColor: Colors.surface,
    gap: 8,
  },
  quickBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 126, 74, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  dismissBtn: {
    width: 32,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 21,
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? 11 : 8,
    paddingBottom: Platform.OS === 'ios' ? 11 : 8,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
});
