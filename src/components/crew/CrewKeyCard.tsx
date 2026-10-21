import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActionSheetIOS } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '../../config/theme';
import { useCrewKeyStore } from '../../store/useCrewKeyStore';
import { startCrew, leaveCrew, rekeyCrew } from '../../services/crew/crewActions';
import { confirmJoin } from '../../services/crew/confirmJoin';
import InviteSheet from './InviteSheet';
import QrScanner from './QrScanner';

function done(now: boolean, what: string) {
  Alert.alert(what, now ? 'Your radio is restarting and reconnects in about 15 seconds.' : 'Your radio switches the next time it connects.');
}

/**
 * Model 2 on the Crew tab: which crew you're in, Invite, Join, and the rarer
 * actions (start a new crew, new key, leave) behind "More".
 */
export default function CrewKeyCard() {
  const model2 = useCrewKeyStore(s => s.model2);
  const crew = useCrewKeyStore(s => s.crew);
  const [inviting, setInviting] = useState(false);
  const [scanning, setScanning] = useState(false);
  if (!model2) return null;

  function askStart() {
    Alert.prompt('Start a crew', 'Name it (only shown in RNDVU, never on the radio).', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start', onPress: async (name?: string) => done(await startCrew(name), 'Crew started') },
    ], 'plain-text', '');
  }

  function more() {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: crew?.displayName,
        options: ['Cancel', 'Start a new crew', 'New crew key', 'Leave crew'],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 3,
      },
      (i) => {
        if (i === 1) askStart();
        if (i === 2) Alert.alert(
          'New crew key?',
          "Use this if someone left with a radio. Everyone else has to scan the new invite; until they do, they can't read the crew.",
          [{ text: 'Cancel', style: 'cancel' }, { text: 'New key', onPress: async () => { done(await rekeyCrew(), 'New key set'); setInviting(true); } }],
        );
        if (i === 3) Alert.alert(
          'Leave the crew?',
          "You stop seeing the crew's messages and location. Your radio still relays for everyone.",
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: async () => done(await leaveCrew(), 'Left the crew') }],
        );
      },
    );
  }

  return (
    <View style={styles.card}>
      {crew ? (
        <>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>YOUR CREW</Text>
              <Text style={styles.name}>{crew.displayName}</Text>
              <Text style={styles.id}>key {crew.id}{crew.source === 'radio' ? ' · from your radio' : ''}</Text>
            </View>
            <TouchableOpacity onPress={more} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.more}>More</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.buttons}>
            <TouchableOpacity style={[styles.btn, styles.primary]} onPress={() => setInviting(true)}>
              <Text style={styles.primaryText}>Invite</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => setScanning(true)}>
              <Text style={styles.btnText}>Join another</Text>
            </TouchableOpacity>
          </View>
          <InviteSheet crew={crew} visible={inviting} onClose={() => setInviting(false)} />
        </>
      ) : (
        <>
          <Text style={styles.label}>NO CREW YET</Text>
          <Text style={styles.body}>Start one and invite people, or scan a crew member's invite.</Text>
          <View style={styles.buttons}>
            <TouchableOpacity style={[styles.btn, styles.primary]} onPress={askStart}>
              <Text style={styles.primaryText}>Start a crew</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => setScanning(true)}>
              <Text style={styles.btnText}>Join with QR</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      <QrScanner
        visible={scanning}
        onCancel={() => setScanning(false)}
        onScanned={(text) => { setScanning(false); setTimeout(() => confirmJoin(text), 400); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.primary + '44', marginBottom: Spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  label: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '800', letterSpacing: 1.2 },
  name: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: '800', marginTop: 2 },
  id: { color: Colors.textSecondary, fontSize: FontSize.xs, fontFamily: 'monospace', marginTop: 2 },
  more: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },
  body: { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  btn: {
    flex: 1, paddingVertical: 10, borderRadius: BorderRadius.full, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.primary,
  },
  primary: { backgroundColor: Colors.primary },
  btnText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '800' },
  primaryText: { color: '#fff', fontSize: FontSize.sm, fontWeight: '800' },
});
