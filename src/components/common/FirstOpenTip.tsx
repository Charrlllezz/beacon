import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SFSymbol } from 'expo-symbols';
import { Colors, Spacing, FontSize, BorderRadius, Fonts } from '../../config/theme';
import Glass from '../ui/Glass';
import GradientButton from '../ui/GradientButton';
import Icon from '../ui/Icon';

interface Tip {
  icon: SFSymbol;
  title: string;
  description: string;
}

interface Props {
  storageKey: string;
  title: string;
  tips: Tip[];
  // True holds the tip back without marking it seen.
  deferred?: boolean;
}

export default function FirstOpenTip({ storageKey, title, tips, deferred = false }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (deferred) return;
    AsyncStorage.getItem(storageKey).then(value => {
      if (value !== 'dismissed') {
        setVisible(true);
      }
    });
  }, [storageKey, deferred]);

  const handleDismiss = async () => {
    setVisible(false);
    await AsyncStorage.setItem(storageKey, 'dismissed');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <Glass style={styles.card} radius={BorderRadius.xl} intensity={60}>
        <View accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>

          <View style={styles.tipsList}>
            {tips.map((tip, index) => (
              <View key={index} style={styles.tipRow}>
                <View style={styles.tipIcon}>
                  <Icon name={tip.icon} size={20} color={Colors.primary} />
                </View>
                <View style={styles.tipContent}>
                  <Text style={styles.tipTitle}>{tip.title}</Text>
                  <Text style={styles.tipDescription}>{tip.description}</Text>
                </View>
              </View>
            ))}
          </View>

          <GradientButton label="Got it" onPress={handleDismiss} />
        </View>
        </Glass>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    padding: Spacing.lg,
  },
  title: {
    fontFamily: Fonts.rounded,
    color: Colors.textPrimary,
    fontSize: FontSize.xl,
    fontWeight: '800',
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  tipsList: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
  tipIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 126, 74, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipContent: {
    flex: 1,
  },
  tipTitle: {
    fontFamily: Fonts.rounded,
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: '700',
    marginBottom: 2,
  },
  tipDescription: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
});
