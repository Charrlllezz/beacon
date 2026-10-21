import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { useMessagesStore } from '../../store/useMessagesStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import { useSosStore, endSos, hiddenSos } from '../../services/sos/SosController';
import { activeSosFromOthers, sosThread } from '../../utils/sos';
import { haversineDistance, formatDistance } from '../../utils/coordinates';
import { timeAgo } from '../../utils/time';
import { hapticMedium } from '../../utils/haptics';
import type { SOSMessage } from '../../types/messages';

/**
 * SOS on every tab. Your own active SOS shows how it's going and the one
 * button that ends it. Someone else's shows who, how far and how fresh,
 * and opens the chat card (where "I'm coming" is).
 */
export default function SosBanner() {
  const active = useSosStore(s => s.active);
  const messages = useMessagesStore(s => s.messages);
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  const myLocation = useCrewStore(s => s.myLocation);
  const navigation = useNavigation();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const mine = useMemo(() => {
    if (!active?.rootPacketId) return null;
    const root = messages.find(m => m.type === 'sos' && m.packetId === active.rootPacketId) as SOSMessage | undefined;
    return root ? sosThread(messages, root) : null;
  }, [active, messages]);

  const others = useMemo(
    () => activeSosFromOthers(messages, myNodeNum).filter(t => !hiddenSos.has(t.key)),
    [messages, myNodeNum],
  );

  if (active) {
    const coming = mine?.coming.map(r => r.name) ?? [];
    const status = active.ending
      ? "Telling your crew you're OK…"
      : active.rootPacketId === null
        ? 'Waiting for your radio to send it…'
        : `Sent ${active.sends}× · last ${active.lastSentAt ? timeAgo(active.lastSentAt / 1000) : '—'}`;
    return (
      <View style={[styles.banner, styles.mine]}>
        <View style={styles.text}>
          <Text style={styles.title}>🆘 Your SOS is on</Text>
          <Text style={styles.sub}>{status}</Text>
          {coming.length > 0 && <Text style={styles.coming}>{coming.join(', ')} coming</Text>}
        </View>
        {!active.ending && (
          <TouchableOpacity
            style={styles.okBtn}
            onPress={() => Alert.alert(
              "Cancel your SOS?",
              "Your crew is told you're OK, and your location stops being sent every 2 minutes.",
              [
                { text: 'Keep it on', style: 'cancel' },
                { text: "I'm OK", onPress: () => { hapticMedium(); endSos(); } },
              ],
            )}
            accessibilityRole="button"
            accessibilityLabel="I'm OK, cancel SOS"
          >
            <Text style={styles.okText}>I'm OK</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (others.length === 0) return null;
  const t = others[0];
  const dist = myLocation ? formatDistance(haversineDistance(myLocation.lat, myLocation.lng, t.lat, t.lng)) : null;
  return (
    <TouchableOpacity
      style={[styles.banner, styles.theirs]}
      onPress={() => (navigation as any).navigate('Chat')}
      activeOpacity={0.8}
      accessibilityRole="button"
    >
      <View style={styles.text}>
        <Text style={styles.title}>🆘 {t.root.fromName} needs help{others.length > 1 ? ` (+${others.length - 1} more)` : ''}</Text>
        <Text style={styles.sub}>
          {dist ? `${dist} · ` : ''}location {timeAgo(t.updatedAt / 1000)}
          {t.coming.length > 0 ? ` · ${t.coming.map(r => r.name).join(', ')} coming` : ''}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => { hiddenSos.add(t.key); force(x => x + 1); }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel="Hide this SOS banner"
      >
        <Text style={styles.close}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    borderBottomWidth: 1,
  },
  mine: { backgroundColor: Colors.error + '33', borderBottomColor: Colors.error },
  theirs: { backgroundColor: Colors.error + '22', borderBottomColor: Colors.error + '88' },
  text: { flex: 1 },
  title: { color: Colors.error, fontSize: FontSize.sm, fontWeight: '900' },
  sub: { color: Colors.textPrimary, fontSize: FontSize.xs, marginTop: 2 },
  coming: { color: Colors.success, fontSize: FontSize.xs, fontWeight: '700', marginTop: 2 },
  okBtn: {
    backgroundColor: Colors.success,
    borderRadius: BorderRadius.full,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  okText: { color: '#000', fontSize: FontSize.sm, fontWeight: '900' },
  close: { color: Colors.textSecondary, fontSize: 16, paddingHorizontal: 4 },
});
