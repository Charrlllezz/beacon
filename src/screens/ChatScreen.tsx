import React, { useRef, useState, useCallback } from 'react';
import {
  View, FlatList, StyleSheet, KeyboardAvoidingView,
  Platform, Text, Alert, Modal, TouchableOpacity,
  ScrollView, TextInput,
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
import RNDVUHeader from '../components/common/RNDVUHeader';
import MapPinPicker from '../components/map/MapPinPicker';
import ScrollPicker from '../components/common/ScrollPicker';
import { bleService } from '../services/ble/BleManager';
import { festivalConfig } from '../services/festival/FestivalConfig';
import type { Message } from '../types/messages';
import {
  buildRallyMessage,
  buildSOSMessage,
  buildHeadingMessage,
  buildGoingMessage,
  buildMeetupMessage,
  parseMessage,
} from '../services/mesh/MessageService';
import { hapticLight, hapticMedium, hapticWarning } from '../utils/haptics';

function to12Hour(h24: number): { hour12: number; ampm: 'AM' | 'PM' } {
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, ampm };
}

function to24Hour(hour12: number, ampm: 'AM' | 'PM'): number {
  if (ampm === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES_5 = Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, '0'));
const AMPM = ['AM', 'PM'];

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
  const [showMeetupPicker, setShowMeetupPicker] = useState(false);
  const [meetupHour12, setMeetupHour12] = useState(8);
  const [meetupAmPm, setMeetupAmPm] = useState<'AM' | 'PM'>('PM');
  const [meetupMinute, setMeetupMinute] = useState(0);
  const [meetupLocation, setMeetupLocation] = useState('');
  const [meetupCustomLocation, setMeetupCustomLocation] = useState('');
  const [meetupLocationMode, setMeetupLocationMode] = useState<'stage' | 'custom' | 'pin'>('stage');
  const [meetupPinCoord, setMeetupPinCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [meetupNote, setMeetupNote] = useState('');
  const [showMeetupMapPicker, setShowMeetupMapPicker] = useState(false);
  const [showRallyPicker, setShowRallyPicker] = useState(false);
  const [showRallyMapPicker, setShowRallyMapPicker] = useState(false);
  const [rallyNote, setRallyNote] = useState('');

  const myName = myNodeNum ? (crewMembers[myNodeNum]?.longName ?? 'You') : 'You';
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToBottom = useCallback(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: false });
    }, 100);
  }, []);

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
      Alert.alert('Send Failed', 'Message could not be sent. Check your device connection.');
    }
    scrollToBottom();
  }, [myNodeNum, myName, addMessage]);

  const sendHeading = useCallback(async (stageId: string) => {
    await sendRaw(buildHeadingMessage(stageId));
    setShowQuickActions(false);
  }, [sendRaw]);

  const openRallyPicker = useCallback(() => {
    setShowQuickActions(false);
    setRallyNote('');
    setShowRallyPicker(true);
  }, []);

  const sendRallyAtLocation = useCallback(async (lat: number, lng: number, note?: string) => {
    hapticMedium();
    await sendRaw(buildRallyMessage(lat, lng, note || undefined));
  }, [sendRaw]);

  const sendSOS = useCallback(async () => {
    if (!myLocation) {
      Alert.alert('No Location', "Your location isn't available yet. Make sure location access is enabled.");
      return;
    }
    hapticWarning();
    Alert.alert(
      'Send SOS?',
      'This will alert your entire crew with your location. Only use in a real emergency.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS',
          style: 'destructive',
          onPress: async () => {
            hapticWarning();
            await sendRaw(buildSOSMessage(myLocation.lat, myLocation.lng));
            setShowQuickActions(false);
          },
        },
      ],
    );
  }, [myLocation, sendRaw]);

  const openMeetupPicker = useCallback(() => {
    setShowQuickActions(false);
    const stages = festivalConfig.getAllStages();
    setMeetupLocation(stages.length > 0 ? stages[0].id : '');
    setMeetupCustomLocation('');
    setMeetupLocationMode('stage');
    setMeetupPinCoord(null);
    setMeetupHour12(8);
    setMeetupAmPm('PM');
    setMeetupMinute(0);
    setMeetupNote('');
    setShowMeetupPicker(true);
  }, []);

  const handleOpenMeetupMap = useCallback(() => {
    setMeetupLocationMode('pin');
    // Close meetup sheet first so the map modal can render on top
    setShowMeetupPicker(false);
    setTimeout(() => setShowMeetupMapPicker(true), 350);
  }, []);

  const handleMeetupMapConfirm = useCallback((coord: { latitude: number; longitude: number }) => {
    setMeetupPinCoord({ lat: coord.latitude, lng: coord.longitude });
    setShowMeetupMapPicker(false);
    // Re-open the meetup sheet after map closes
    setTimeout(() => setShowMeetupPicker(true), 350);
    hapticLight();
  }, []);

  const handleMeetupMapCancel = useCallback(() => {
    setShowMeetupMapPicker(false);
    setTimeout(() => setShowMeetupPicker(true), 350);
  }, []);

  const sendMeetup = useCallback(async () => {
    let locationStr = '';
    let lat: number | undefined;
    let lng: number | undefined;

    if (meetupLocationMode === 'stage') {
      if (!meetupLocation) return;
      locationStr = meetupLocation;
    } else if (meetupLocationMode === 'custom') {
      if (!meetupCustomLocation.trim()) return;
      locationStr = meetupCustomLocation.trim();
    } else if (meetupLocationMode === 'pin') {
      if (!meetupPinCoord) return;
      locationStr = 'Dropped Pin';
      lat = meetupPinCoord.lat;
      lng = meetupPinCoord.lng;
    }

    const meetupHour24 = to24Hour(meetupHour12, meetupAmPm);
    const wireMsg = buildMeetupMessage(meetupHour24, meetupMinute, locationStr, meetupNote || undefined, lat, lng);
    hapticLight();
    await sendRaw(wireMsg);
    setShowMeetupPicker(false);
  }, [meetupHour12, meetupAmPm, meetupMinute, meetupLocation, meetupCustomLocation, meetupLocationMode, meetupPinCoord, meetupNote, sendRaw]);

  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <MessageItem item={item} myNodeNum={myNodeNum} />
  ), [myNodeNum]);

  const onlineCount = Object.values(crewMembers).filter(m => !m.isSelf).length;
  const stages = festivalConfig.getAllStages();

  return (
    <SafeAreaView style={styles.container}>
      <RNDVUHeader
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
            <Text style={styles.emptyEmoji}>👋</Text>
            <Text style={styles.emptyTitle}>Welcome to RNDVU!</Text>
            <Text style={styles.welcomeBody}>
              Thanks for being here and giving us a shot — we really appreciate it! We built RNDVU to keep your crew connected when it matters most, no cell service or Wi-Fi needed.
            </Text>
            <Text style={styles.welcomeBody}>
              Tap the + button below to drop a rally point, send an SOS, set a meetup time and place, or let your crew know which stage you're heading to.
            </Text>
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
            onSendRally={openRallyPicker}
            onSendSOS={sendSOS}
            onSetMeetup={openMeetupPicker}
            onClose={() => setShowQuickActions(false)}
          />
        )}

        <ChatInput
          onSend={sendRaw}
          onQuickAction={() => setShowQuickActions(v => !v)}
          disabled={status !== 'connected'}
        />
      </KeyboardAvoidingView>

      {/* Rally picker modal */}
      <Modal visible={showRallyPicker} transparent animationType="slide" onRequestClose={() => setShowRallyPicker(false)}>
        <View style={styles.meetupBackdrop}>
          <View style={styles.meetupSheet}>
            <View style={styles.meetupHandle} />
            <Text style={styles.meetupTitle}>Rally Point</Text>

            <Text style={styles.meetupLabel}>MESSAGE (OPTIONAL)</Text>
            <TextInput
              style={styles.meetupTextInput}
              placeholder="Add a note..."
              placeholderTextColor={Colors.textMuted}
              value={rallyNote}
              onChangeText={setRallyNote}
              maxLength={50}
              keyboardAppearance="dark"
            />

            <View style={styles.rallyActions}>
              <TouchableOpacity style={styles.meetupCancel} onPress={() => setShowRallyPicker(false)}>
                <Text style={styles.meetupCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.rallyBtn}
                onPress={() => {
                  if (!myLocation) {
                    Alert.alert('No Location', "Your location isn't available yet.");
                    return;
                  }
                  sendRallyAtLocation(myLocation.lat, myLocation.lng, rallyNote || undefined);
                  setShowRallyPicker(false);
                }}
              >
                <Text style={styles.rallyBtnText}>My Location</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.rallyPinBtn}
                onPress={() => {
                  setShowRallyPicker(false);
                  setTimeout(() => setShowRallyMapPicker(true), 350);
                }}
              >
                <Text style={styles.rallyPinBtnText}>Drop Pin</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rally map pin picker */}
      <MapPinPicker
        visible={showRallyMapPicker}
        initialCoord={myLocation ? { latitude: myLocation.lat, longitude: myLocation.lng } : null}
        title="Drop Rally Pin"
        onCancel={() => setShowRallyMapPicker(false)}
        onConfirm={(coord) => {
          setShowRallyMapPicker(false);
          sendRallyAtLocation(coord.latitude, coord.longitude, rallyNote || undefined);
        }}
      />

      {/* Meetup picker modal */}
      <Modal visible={showMeetupPicker} transparent animationType="slide" onRequestClose={() => setShowMeetupPicker(false)}>
        <View style={styles.meetupBackdrop}>
          <View style={styles.meetupSheet}>
            <View style={styles.meetupHandle} />
            <Text style={styles.meetupTitle}>Set a Meetup</Text>

            <Text style={styles.meetupLabel}>TIME</Text>
            <View style={styles.timeRow}>
              <ScrollPicker
                items={HOURS_12}
                selectedIndex={meetupHour12 - 1}
                onSelect={(i) => setMeetupHour12(i + 1)}
                width={48}
              />
              <Text style={styles.timeColon}>:</Text>
              <ScrollPicker
                items={MINUTES_5}
                selectedIndex={MINUTES_5.indexOf(meetupMinute.toString().padStart(2, '0'))}
                onSelect={(i) => setMeetupMinute(i * 5)}
                width={48}
              />
              <ScrollPicker
                items={AMPM}
                selectedIndex={meetupAmPm === 'AM' ? 0 : 1}
                onSelect={(i) => setMeetupAmPm(i === 0 ? 'AM' : 'PM')}
                width={54}
              />
            </View>

            <Text style={styles.meetupLabel}>LOCATION</Text>
            {/* Mode tabs */}
            <View style={styles.locationModeRow}>
              <TouchableOpacity
                style={[styles.locationModeTab, meetupLocationMode === 'stage' && styles.locationModeTabActive]}
                onPress={() => setMeetupLocationMode('stage')}
              >
                <Text style={[styles.locationModeText, meetupLocationMode === 'stage' && styles.locationModeTextActive]}>Stage</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locationModeTab, meetupLocationMode === 'custom' && styles.locationModeTabActive]}
                onPress={() => setMeetupLocationMode('custom')}
              >
                <Text style={[styles.locationModeText, meetupLocationMode === 'custom' && styles.locationModeTextActive]}>Custom</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locationModeTab, meetupLocationMode === 'pin' && styles.locationModeTabActive]}
                onPress={handleOpenMeetupMap}
              >
                <Text style={[styles.locationModeText, meetupLocationMode === 'pin' && styles.locationModeTextActive]}>Drop Pin</Text>
              </TouchableOpacity>
            </View>

            {meetupLocationMode === 'stage' && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.locationRow}>
                {stages.map(stage => (
                  <TouchableOpacity
                    key={stage.id}
                    style={[styles.locationChip, meetupLocation === stage.id && { borderColor: stage.color, backgroundColor: stage.color + '22' }]}
                    onPress={() => setMeetupLocation(stage.id)}
                  >
                    <Text style={[styles.locationChipText, meetupLocation === stage.id && { color: stage.color }]}>
                      {stage.shortName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {meetupLocationMode === 'custom' && (
              <TextInput
                style={styles.meetupTextInput}
                placeholder="e.g. Ferris wheel, Art installation..."
                placeholderTextColor={Colors.textMuted}
                value={meetupCustomLocation}
                onChangeText={setMeetupCustomLocation}
                maxLength={30}
                keyboardAppearance="dark"
              />
            )}

            {meetupLocationMode === 'pin' && (
              <TouchableOpacity style={styles.pinInfo} onPress={handleOpenMeetupMap}>
                <Text style={styles.pinEmoji}>📍</Text>
                <Text style={styles.pinText}>
                  {meetupPinCoord
                    ? `Pin dropped\n${meetupPinCoord.lat.toFixed(4)}, ${meetupPinCoord.lng.toFixed(4)}`
                    : 'Opening map...'}
                </Text>
                <Text style={styles.pinEditText}>Edit</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.meetupLabel}>MESSAGE (OPTIONAL)</Text>
            <TextInput
              style={styles.meetupTextInput}
              placeholder="Add a message..."
              placeholderTextColor={Colors.textMuted}
              value={meetupNote}
              onChangeText={setMeetupNote}
              maxLength={40}
              keyboardAppearance="dark"
            />

            <View style={styles.meetupActions}>
              <TouchableOpacity style={styles.meetupCancel} onPress={() => setShowMeetupPicker(false)}>
                <Text style={styles.meetupCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.meetupSend} onPress={sendMeetup}>
                <Text style={styles.meetupSendText}>Send Meetup</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Meetup map pin picker */}
      <MapPinPicker
        visible={showMeetupMapPicker}
        initialCoord={myLocation ? { latitude: myLocation.lat, longitude: myLocation.lng } : null}
        title="Drop Meetup Pin"
        onCancel={handleMeetupMapCancel}
        onConfirm={handleMeetupMapConfirm}
      />
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
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  emptyEmoji: { fontSize: 48, marginBottom: Spacing.md },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  welcomeBody: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  // Meetup picker
  meetupBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  meetupSheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.lg,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: Colors.warning + '33',
  },
  meetupHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.textMuted,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  meetupTitle: {
    fontSize: FontSize.lg,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  meetupLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  timeColon: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.warning,
    marginHorizontal: 2,
    marginBottom: 2,
  },
  locationModeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: Spacing.sm,
  },
  locationModeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  locationModeTabActive: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warning + '18',
  },
  locationModeText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },
  locationModeTextActive: { color: Colors.warning },
  locationRow: { gap: 8 },
  locationChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  locationChipText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '700' },
  meetupTextInput: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pinInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
  },
  pinEmoji: { fontSize: 24 },
  pinText: { color: Colors.textSecondary, fontSize: FontSize.sm, flex: 1 },
  pinEditText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
  rallyActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  rallyBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  rallyBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '700' },
  rallyPinBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  rallyPinBtnText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },
  meetupActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  meetupCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  meetupCancelText: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '600' },
  meetupSend: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    backgroundColor: Colors.warning,
  },
  meetupSendText: { color: '#000', fontSize: FontSize.md, fontWeight: '700' },
});
