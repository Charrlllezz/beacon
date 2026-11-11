import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Share, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius, Fonts } from '../../config/theme';
import GradientButton from '../ui/GradientButton';
import type { Crew } from '../../store/useCrewKeyStore';
import { buildInviteUrl, buildMeshtasticUrl } from '../../services/crew/invite';
import QrCode from './QrCode';

interface Props {
  crew: Crew;
  visible: boolean;
  onClose: () => void;
}

/**
 * The crew's invite as a QR. Anyone in the crew can show it (everyone holds
 * the key), which covers late joiners. A second QR is for people using the
 * official Meshtastic app.
 */
export default function InviteSheet({ crew, visible, onClose }: Props) {
  const [forMeshtastic, setForMeshtastic] = useState(false);
  const { width } = useWindowDimensions();
  const url = forMeshtastic ? buildMeshtasticUrl(crew.psk) : buildInviteUrl(crew.psk, crew.displayName);
  const size = Math.min(width - Spacing.xl * 2, 320);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Invite to {crew.displayName}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.body}>
          <Text style={styles.lead}>
            {forMeshtastic
              ? 'For someone using the Meshtastic app: they scan this in Meshtastic to join the channel.'
              : 'They open RNDVU, go to Crew → Join, and scan this. (The iPhone camera opens RNDVU too.)'}
          </Text>
          <QrCode value={url} size={size} />
          <Text style={styles.warn}>Anyone who scans this can read your crew's messages and see where you are. Only show it to your crew.</Text>
          <View style={styles.row}>
            <GradientButton compact variant="ghost" label={forMeshtastic ? 'Show the RNDVU QR' : 'For the Meshtastic app'} onPress={() => setForMeshtastic(v => !v)} />
            <GradientButton compact label="Share link" icon="square.and.arrow.up" onPress={() => Share.share({ message: url }).catch(() => {})} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border,
  },
  title: { fontFamily: Fonts.rounded, fontSize: FontSize.xl, fontWeight: '800', color: Colors.textPrimary, flex: 1, marginRight: Spacing.sm },
  close: { fontFamily: Fonts.rounded, fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  body: { alignItems: 'center', padding: Spacing.lg, gap: Spacing.md },
  lead: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center' },
  warn: { color: Colors.warning, fontSize: FontSize.xs, textAlign: 'center' },
  row: { flexDirection: 'row', gap: Spacing.sm },
});
