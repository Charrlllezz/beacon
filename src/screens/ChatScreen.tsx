import React, { useRef, useState, useCallback } from 'react';
import {
  View, FlatList, StyleSheet, KeyboardAvoidingView,
  Platform, Text, Alert, Modal, TouchableOpacity,
  Image, ScrollView, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BorderRadius, FontSize, Colors, Spacing } from '../config/theme';
import { useMessagesStore } from '../store/useMessagesStore';
import { useDeviceStore } from '../store/useDeviceStore';
import { useCrewStore } from '../store/useCrewStore';
import { useScheduleStore } from '../store/useScheduleStore';
import ChatInput from '../components/chat/ChatInput';
import QuickActions from '../components/chat/QuickActions';
import MessageItem from '../components/chat/MessageItem';
import ConnectionBar from '../components/common/ConnectionBar';
import BeaconHeader from '../components/common/BeaconHeader';
import { bleService } from '../services/ble/BleManager';
import { festivalConfig } from '../services/festival/FestivalConfig';
import type { Message } from '../types/messages';
import {
  buildRallyMessage,
  buildSOSMessage,
  buildHeadingMessage,
  buildGoingMessage,
  parseMessage,
} from '../services/mesh/MessageService';
import { gpsToMapPixel, mapPixelToGps, MAP_IMG_W, MAP_IMG_H } from '../utils/coordinates';
import { hapticLight, hapticMedium, hapticWarning } from '../utils/haptics';

const mapImage = require('../assets/lib-2026-map.png');

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const PICKER_H = SCREEN_H - 160;
const PICKER_SCALE = PICKER_H / MAP_IMG_H;
const PICKER_W = MAP_IMG_W * PICKER_SCALE;

function gpsToPixel(lat: number, lng: number): { x: number; y: number } | null {
  const raw = gpsToMapPixel(lat, lng);
  if (!raw) return null;
  return { x: raw.x * PICKER_SCALE, y: raw.y * PICKER_SCALE };
}

function pixelToGps(x: number, y: number): { lat: number; lng: number } {
  return mapPixelToGps(x / PICKER_SCALE, y / PICKER_SCALE);
}

export default function ChatScreen() {
  const messages = useMessagesStore(s => s.messages);
  const addMessage = useMessagesStore(s => s.addMessage);
  const status = useDeviceStore(s => s.status);
  const myNodeNum = useDeviceStore(s => s.myNodeNum);
  const channelName = useDeviceStore(s => s.channelName);
  const myLocation = useCrewStore(s => s.myLocation);
  const crewMembers = useCrewStore(s => s.crewMembers);
  const flatListRef = useRef<FlatList>(null);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [pickedLocation, setPickedLocation] = useState<{ lat: number; lng: number } | null>(null);

  const myName = myNodeNum ? (crewMembers[myNodeNum]?.longName ?? 'You') : 'You';
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToBottom = useCallback(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: false });
    }, 100);
  }, []);

  // Clean up scroll timer on unmount
  React.useEffect(() => {
    return () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, []);

  const sendRaw = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const now = Date.now();
    const myId = myNodeNum ?? 0;
    const msg = parseMessage(text, myId, myName, now, 0);
    addMessage({ ...msg, id: `self-${now}-${Math.random()}` });

    // Handle going messages locally too
    if (msg.type === 'going') {
      useScheduleStore.getState().addGoingEntry({
        nodeId: myId,
        nodeName: myName,
        stageId: msg.stageId,
        artistId: msg.artistId,
        timestamp: now,
      });
    }

    try {
      await bleService.sendText(text);
    } catch (e) {
      console.warn('Send failed:', e);
    }
    scrollToBottom();
  }, [myNodeNum, myName, addMessage]);

  const sendHeading = useCallback(async (stageId: string) => {
    await sendRaw(buildHeadingMessage(stageId));
    setShowQuickActions(false);
  }, [sendRaw]);

  const sendRally = useCallback(() => {
    setShowQuickActions(false);
    Alert.alert('Rally Point', 'How do you want to set the location?', [
      {
        text: 'Use My Location',
        onPress: async () => {
          if (!myLocation) {
            Alert.alert('No Location', "Your location isn't available yet. Make sure location access is enabled.");
            return;
          }
          await sendRaw(buildRallyMessage(myLocation.lat, myLocation.lng, 'Meet here'));
        },
      },
      {
        text: 'Pick on Map',
        onPress: () => {
          setPickedLocation(null);
          setShowMapPicker(true);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [myLocation, sendRaw]);

  const confirmMapPick = useCallback(async () => {
    if (!pickedLocation) return;
    hapticLight();
    await sendRaw(buildRallyMessage(pickedLocation.lat, pickedLocation.lng, 'Meet here'));
    setShowMapPicker(false);
    setPickedLocation(null);
  }, [pickedLocation, sendRaw]);

  const sendSOS = useCallback(async () => {
    if (!myLocation) {
      Alert.alert('No Location', "Your location isn't available yet. Make sure location access is enabled.");
      return;
    }
    hapticWarning();
    await sendRaw(buildSOSMessage(myLocation.lat, myLocation.lng));
    setShowQuickActions(false);
  }, [myLocation, sendRaw]);

  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <MessageItem item={item} myNodeNum={myNodeNum} />
  ), [myNodeNum]);

  const onlineCount = Object.values(crewMembers).filter(m => !m.isSelf).length;

  return (
    <SafeAreaView style={styles.container}>
      <BeaconHeader
        title={channelName}
        subtitle={onlineCount > 0 ? `${onlineCount} crew online` : undefined}
      />
      <ConnectionBar />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📡</Text>
            <Text style={styles.emptyTitle}>Your crew is on the mesh</Text>
            <Text style={styles.emptySubtitle}>Messages will appear here</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={scrollToBottom}
            onLayout={scrollToBottom}
            removeClippedSubviews
            maxToRenderPerBatch={20}
            windowSize={10}
            keyboardDismissMode="on-drag"
          />
        )}

        {showQuickActions && (
          <QuickActions
            onSendHeading={sendHeading}
            onSendRally={sendRally}
            onSendSOS={sendSOS}
            onClose={() => setShowQuickActions(false)}
          />
        )}

        <ChatInput
          onSend={sendRaw}
          onQuickAction={() => setShowQuickActions(v => !v)}
          disabled={status !== 'connected'}
        />
      </KeyboardAvoidingView>

      {/* Map pin-drop modal */}
      <Modal visible={showMapPicker} animationType="slide" onRequestClose={() => setShowMapPicker(false)}>
        <View style={styles.mapModal}>
          <View style={styles.mapModalHeader}>
            <TouchableOpacity onPress={() => setShowMapPicker(false)}>
              <Text style={styles.mapModalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.mapModalTitle}>Drop a Pin</Text>
            <View style={{ width: 50 }} />
          </View>
          {!pickedLocation && (
            <Text style={styles.mapModalHint}>Tap anywhere on the map to place your rally point</Text>
          )}
          <ScrollView
            horizontal
            maximumZoomScale={5}
            minimumZoomScale={1}
            bouncesZoom
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            contentOffset={{ x: (PICKER_W - SCREEN_W) / 2, y: 0 }}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={{ width: PICKER_W, height: PICKER_H }}
              onPress={e => {
                const { locationX, locationY } = e.nativeEvent;
                const gps = pixelToGps(locationX, locationY);
                hapticMedium();
                setPickedLocation(gps);
              }}
            >
              <Image source={mapImage} style={{ width: PICKER_W, height: PICKER_H }} />
              {pickedLocation && (() => {
                const pos = gpsToPixel(pickedLocation.lat, pickedLocation.lng);
                if (!pos) return null;
                return (
                  <View style={[styles.rallyPin, { left: pos.x - 10, top: pos.y - 26 }]}>
                    <View style={styles.rallyPinCircle} />
                    <View style={styles.rallyPinTail} />
                  </View>
                );
              })()}
            </TouchableOpacity>
          </ScrollView>

          {pickedLocation && (
            <View style={styles.mapConfirmCard}>
              <Text style={styles.mapConfirmTitle}>📍 Rally point placed</Text>
              <Text style={styles.mapConfirmCoords}>
                {pickedLocation.lat.toFixed(5)}, {pickedLocation.lng.toFixed(5)}
              </Text>
              <View style={styles.mapConfirmActions}>
                <TouchableOpacity
                  style={styles.mapConfirmReplace}
                  onPress={() => setPickedLocation(null)}
                >
                  <Text style={styles.mapConfirmReplaceText}>Place Again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mapConfirmSend} onPress={confirmMapPick}>
                  <Text style={styles.mapConfirmSendText}>Send to Crew</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  messageList: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyEmoji: { fontSize: 48, marginBottom: Spacing.md },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: { color: Colors.textSecondary, fontSize: 14 },
  mapModal: { flex: 1, backgroundColor: Colors.background },
  mapModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  mapModalTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '700' },
  mapModalCancel: { color: Colors.textSecondary, fontSize: FontSize.md },
  mapModalHint: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  rallyPin: { position: 'absolute', alignItems: 'center' },
  rallyPinCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: '#fff',
  },
  rallyPinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: Colors.primary,
    marginTop: -2,
  },
  mapConfirmCard: {
    position: 'absolute',
    bottom: '35%',
    left: Spacing.xl,
    right: Spacing.xl,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  mapConfirmTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '700', marginBottom: 4 },
  mapConfirmCoords: { color: Colors.textMuted, fontSize: FontSize.xs, marginBottom: Spacing.md },
  mapConfirmActions: { flexDirection: 'row', gap: Spacing.sm, width: '100%' },
  mapConfirmReplace: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mapConfirmReplaceText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },
  mapConfirmSend: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  mapConfirmSendText: { color: '#fff', fontSize: FontSize.sm, fontWeight: '700' },
});
