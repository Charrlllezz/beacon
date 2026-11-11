import React, { useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors, Spacing, FontSize, BorderRadius, Fonts } from '../../config/theme';
import GradientButton from '../ui/GradientButton';

interface Props {
  visible: boolean;
  onScanned: (text: string) => void;
  onCancel: () => void;
}

/** Full-screen QR scanner for crew invites. Reports the first code it sees. */
export default function QrScanner({ visible, onScanned, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  // The camera keeps firing while the code is in view; take one.
  const handled = useRef(false);
  if (!visible) handled.current = false;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Scan a crew invite</Text>
          <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.close}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {!permission ? null : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.body}>RNDVU needs the camera to scan your crew's QR code.</Text>
            <GradientButton
              label={permission.canAskAgain ? 'Allow camera' : 'Open Settings'}
              icon="camera"
              onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
            />
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (handled.current) return;
                handled.current = true;
                onScanned(data);
              }}
            />
            <View style={styles.frame} pointerEvents="none" />
            <Text style={styles.hint}>Point at the QR on a crew member's phone (Crew tab → Invite)</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  title: { fontFamily: Fonts.rounded, color: '#fff', fontSize: FontSize.xl, fontWeight: '800' },
  close: { fontFamily: Fonts.rounded, color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  body: { color: Colors.textPrimary, fontSize: FontSize.md, textAlign: 'center' },
  cameraWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: Colors.primary, borderRadius: BorderRadius.xl },
  hint: {
    position: 'absolute', bottom: Spacing.xl, left: Spacing.lg, right: Spacing.lg,
    color: '#fff', textAlign: 'center', fontSize: FontSize.sm, fontWeight: '600',
  },
});
