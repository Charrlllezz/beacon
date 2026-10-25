import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { useFindStore } from '../../store/useFindStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useCrewStore } from '../../store/useCrewStore';
import { stopHelping, HELP_MS } from '../../services/find/FindController';
import { startPreciseFind } from '../../../modules/rndvu-nearby';
import { formatPrecise } from '../../utils/preciseFind';

// Light-up flashes the screen between your crew colour and white, so a friend
// scanning the crowd can spot the phone you hold up. Twice a second is easy
// to see without being a strobe hazard (well under 3 flashes a second).
const FLASH_MS = 500;

/**
 * The friend's side of Find me: shown at the app root while helping someone
 * find you. Their phone already gets your GPS every 15 s; this screen also
 * runs Ultra Wideband with them (exact distance when close) and offers
 * light-up mode.
 */
export default function HelpFindSheet() {
  const helping = useFindStore(s => s.helping);
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  const myColor = useCrewStore(s => s.myColor) ?? Colors.primary;
  const [distance, setDistance] = useState<number | null>(null);
  const [lightUp, setLightUp] = useState(false);
  const [flashOn, setFlashOn] = useState(true);
  // Ticks the "N more min" countdown. (useNow arrives with the Lineup PR,
  // #37; this stack doesn't depend on it.)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);
  const finder = helping?.finder ?? null;

  useEffect(() => {
    if (finder === null || !myNodeNum) return;
    const stop = startPreciseFind(myNodeNum, finder, e => {
      if (e.distance !== undefined) setDistance(e.distance);
      else if (e.state === 'lost' || e.state === 'ended') setDistance(null);
    });
    return () => { stop?.(); setDistance(null); setLightUp(false); };
  }, [finder, myNodeNum]);

  useEffect(() => {
    if (!lightUp) return;
    const t = setInterval(() => setFlashOn(v => !v), FLASH_MS);
    return () => clearInterval(t);
  }, [lightUp]);

  if (!helping) return null;
  const minsLeft = Math.max(1, Math.ceil((helping.startedAt + HELP_MS - now) / 60_000));

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => stopHelping()}>
      {lightUp ? (
        <Pressable style={[styles.flash, { backgroundColor: flashOn ? myColor : '#ffffff' }]} onPress={() => setLightUp(false)}>
          <Text style={[styles.flashText, { color: flashOn ? '#ffffff' : '#000000' }]}>Hold your phone up high</Text>
          <Text style={[styles.flashHint, { color: flashOn ? '#ffffff' : '#000000' }]}>Tap to stop flashing</Text>
        </Pressable>
      ) : (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.body}>
            <Text style={styles.title}>{helping.finderName} is finding you</Text>
            {distance !== null ? (
              <Text style={styles.distance}>{formatPrecise(distance)}</Text>
            ) : (
              <Text style={styles.searching}>Sending your exact spot every 15 seconds.</Text>
            )}
            <Text style={styles.lead}>
              {distance !== null
                ? 'They\'re close. Light up your screen so they can spot you.'
                : `Keep RNDVU open. When ${helping.finderName} gets close, your phones measure the exact distance.`}
            </Text>
            <TouchableOpacity style={[styles.lightButton, { backgroundColor: myColor }]} onPress={() => setLightUp(true)}>
              <Text style={styles.lightButtonText}>Light up my screen</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.footer}>Sharing for {minsLeft} more min</Text>
          <TouchableOpacity style={styles.stopButton} onPress={() => stopHelping()}>
            <Text style={styles.stopButtonText}>Stop sharing</Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md },
  title: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  distance: { fontSize: 64, fontWeight: '800', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  searching: { fontSize: FontSize.md, color: Colors.success, fontWeight: '700', textAlign: 'center' },
  lead: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', maxWidth: 320 },
  lightButton: { marginTop: Spacing.lg, borderRadius: BorderRadius.full, paddingVertical: 18, paddingHorizontal: Spacing.xl },
  lightButtonText: { color: '#ffffff', fontSize: FontSize.lg, fontWeight: '800' },
  footer: { textAlign: 'center', color: Colors.textSecondary, fontSize: FontSize.xs },
  stopButton: {
    margin: Spacing.md, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.full,
    paddingVertical: 14, alignItems: 'center',
  },
  stopButtonText: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '700' },
  flash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  flashText: { fontSize: FontSize.xxl, fontWeight: '900' },
  flashHint: { fontSize: FontSize.sm },
});
