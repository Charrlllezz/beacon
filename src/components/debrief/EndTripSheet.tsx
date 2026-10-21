import React, { useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Share, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { festivalConfig } from '../../services/festival/FestivalConfig';
import { useMessagesStore } from '../../store/useMessagesStore';
import { useCrewStore } from '../../store/useCrewStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { bleService } from '../../services/ble/BleManager';
import {
  debriefStats, formatDebrief,
  type DebriefAnswers, type Delivery, type PhoneBattery, type WouldPay,
} from '../../utils/debrief';

const doneKey = (festivalId: string) => `rndvu_debrief_${festivalId}`;

interface EndTripState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useEndTripStore = create<EndTripState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Has this phone already done (or skipped) the debrief for a festival? */
export async function debriefHandled(festivalId: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(doneKey(festivalId))) !== null; } catch { return false; }
}

export async function skipDebrief(festivalId: string): Promise<void> {
  try { await AsyncStorage.setItem(doneKey(festivalId), JSON.stringify({ skippedAt: Date.now() })); } catch {}
}

function Choice<T extends string>({ value, options, onChange }: {
  value: T | null; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <View style={styles.choices}>
      {options.map(([v, label]) => (
        <TouchableOpacity
          key={v}
          style={[styles.choice, value === v && styles.choiceOn]}
          onPress={() => onChange(v)}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === v }}
        >
          <Text style={[styles.choiceText, value === v && styles.choiceTextOn]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/**
 * End trip: a few questions, what the phone measured, then share it and
 * hand the radio back. Rendered once at the app root.
 */
export default function EndTripSheet() {
  const open = useEndTripStore(s => s.open);
  const close = () => useEndTripStore.getState().setOpen(false);
  const config = festivalConfig.getConfig();
  const messages = useMessagesStore(s => s.messages);
  const crewMembers = useCrewStore(s => s.crewMembers);
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  const firmware = useDeviceStore(s => s.firmwareVersion);
  const [answers, setAnswers] = useState<DebriefAnswers>({ delivery: null, phoneBattery: null, wouldPay: null, confusing: '' });
  const [step, setStep] = useState<'questions' | 'done'>('questions');

  const stats = useMemo(
    () => debriefStats(config, messages, Object.values(crewMembers), myNodeNum, firmware),
    [config, messages, crewMembers, myNodeNum, firmware],
  );
  const myName = (myNodeNum && crewMembers[myNodeNum]?.longName) || 'me';
  const text = formatDebrief(myName, config.festival.name, answers, stats);

  async function finish() {
    try {
      await AsyncStorage.setItem(doneKey(config.festival.id), JSON.stringify({ answers, stats, submittedAt: Date.now() }));
    } catch {}
    setStep('done');
    Share.share({ message: text }).catch(() => {});
  }

  function releaseRadio() {
    Alert.alert(
      'Release your radio?',
      "RNDVU stops connecting to it. If it was lent to you, give it back. It's wiped before the next crew.",
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Release',
          onPress: () => {
            useDeviceStore.getState().setReleased(true);
            bleService.disconnect();
            close();
          },
        },
      ],
    );
  }

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>End trip · {config.festival.shortName}</Text>
          <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.close}>Close</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {step === 'questions' ? (
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text style={styles.lead}>Two minutes. It decides what gets fixed before the next festival.</Text>

              <Text style={styles.q}>Did your messages get through?</Text>
              <Choice<Delivery>
                value={answers.delivery}
                options={[['always', 'Always'], ['mostly', 'Mostly'], ['sometimes', 'Sometimes'], ['rarely', 'Rarely']]}
                onChange={delivery => setAnswers(a => ({ ...a, delivery }))}
              />

              <Text style={styles.q}>Your phone battery at the end of the night?</Text>
              <Choice<PhoneBattery>
                value={answers.phoneBattery}
                options={[['over50', 'Over 50%'], ['20to50', '20–50%'], ['under20', 'Under 20%'], ['died', 'It died']]}
                onChange={phoneBattery => setAnswers(a => ({ ...a, phoneBattery }))}
              />

              <Text style={styles.q}>Would you pay for RNDVU at your next festival?</Text>
              <Choice<WouldPay>
                value={answers.wouldPay}
                options={[['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']]}
                onChange={wouldPay => setAnswers(a => ({ ...a, wouldPay }))}
              />

              <Text style={styles.q}>Anything confusing or broken?</Text>
              <TextInput
                style={styles.input}
                multiline
                placeholder="Optional"
                placeholderTextColor={Colors.textMuted}
                value={answers.confusing}
                onChangeText={confusing => setAnswers(a => ({ ...a, confusing }))}
                maxLength={500}
                keyboardAppearance="dark"
              />

              <Text style={styles.q}>Measured by the app</Text>
              <View style={styles.stats}>
                <Text style={styles.stat}>Sent {stats.sent} ({stats.failed} failed) · received {stats.received}</Text>
                <Text style={styles.stat}>Crew heard: {stats.crewHeard}</Text>
                <Text style={styles.stat}>Your rally points / meetups answered: {stats.myCardsAnswered}</Text>
                <Text style={styles.stat}>Radio battery now: {stats.radioBattery === null ? 'unknown' : stats.radioBattery > 100 ? 'USB' : `${stats.radioBattery}%`}</Text>
              </View>

              <TouchableOpacity style={styles.primary} onPress={finish}>
                <Text style={styles.primaryText}>Save and share</Text>
              </TouchableOpacity>
              <Text style={styles.hint}>Opens the share sheet. Send it to whoever set up your crew.</Text>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.content}>
              <Text style={styles.doneTitle}>Thanks. Saved on this phone.</Text>
              <TouchableOpacity style={styles.secondary} onPress={() => Share.share({ message: text }).catch(() => {})}>
                <Text style={styles.secondaryText}>Share again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={releaseRadio}>
                <Text style={styles.secondaryText}>Release my radio</Text>
              </TouchableOpacity>
              <Text style={styles.hint}>Borrowed radio? Release it, then hand it back.</Text>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary },
  close: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl },
  lead: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
  q: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  choice: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: BorderRadius.full,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  choiceOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  choiceText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  choiceTextOn: { color: Colors.primary },
  input: {
    minHeight: 80, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md,
    color: Colors.textPrimary, fontSize: FontSize.sm, borderWidth: 1, borderColor: Colors.border, textAlignVertical: 'top',
  },
  stats: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 4, borderWidth: 1, borderColor: Colors.border },
  stat: { fontSize: FontSize.sm, color: Colors.textSecondary },
  primary: { backgroundColor: Colors.primary, borderRadius: BorderRadius.full, paddingVertical: 14, alignItems: 'center', marginTop: Spacing.lg },
  primaryText: { color: '#fff', fontSize: FontSize.md, fontWeight: '800' },
  secondary: {
    borderRadius: BorderRadius.full, paddingVertical: 14, alignItems: 'center', marginTop: Spacing.md,
    borderWidth: 1, borderColor: Colors.primary,
  },
  secondaryText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '800' },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm },
  doneTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.success, marginTop: Spacing.lg },
});
