import { PortNum } from '../../types/mesh';
import type { MeshPacket, FromRadio } from '../../types/mesh';
import { decodeTextMessage, decodePosition, decodeTelemetry } from './MeshtasticCodec';
import { parseMessage } from '../mesh/MessageService';
import { useMessagesStore } from '../../store/useMessagesStore';
import { useCrewStore } from '../../store/useCrewStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useScheduleStore } from '../../store/useScheduleStore';
import { useMapCalibrationStore } from '../../store/useMapCalibrationStore';
import { useTagStore } from '../../store/useTagStore';
import { latLngFromI } from '../../utils/coordinates';

const SEEN_PACKET_MAX = 1000;
const seenPacketIds = new Set<number>();
const seenPacketOrder: number[] = [];

function isPacketDuplicate(packetId: number | undefined): boolean {
  // Skip dedup for undefined (no id field) and 0 (firmware's "no id assigned"
  // placeholder — proto3 default for unset fixed32, or low-level packets like
  // routing ACKs). Real packet ids are random 32-bit; the collision space on
  // 0 is not worth silently dropping bursts of placeholder packets.
  if (packetId === undefined || packetId === 0) return false;
  if (seenPacketIds.has(packetId)) return true;
  seenPacketIds.add(packetId);
  seenPacketOrder.push(packetId);
  if (seenPacketOrder.length > SEEN_PACKET_MAX) {
    const oldest = seenPacketOrder.shift()!;
    seenPacketIds.delete(oldest);
  }
  return false;
}

export function routeFromRadio(fromRadio: FromRadio, myNodeNum: number | null): void {
  if (fromRadio.myInfo) {
    useDeviceStore.getState().setMyNodeInfo(fromRadio.myInfo);
  }

  // Firmware dumps its primary channel during the config drain. Mirror the
  // name/index into our store so the ChatScreen header reflects the real
  // channel instead of a hardcoded default — helps diagnose drift.
  if (fromRadio.channel?.role === 1 /* PRIMARY */) {
    const name = fromRadio.channel.settings?.name;
    if (name) useDeviceStore.getState().setChannelName(name);
    useDeviceStore.getState().setChannelIndex(fromRadio.channel.index);
  }

  // Device metadata (firmware version, hw model, PKC capability) arrives once
  // during config drain. Used by the Debug screen and version-mismatch checks.
  if (fromRadio.metadata) {
    useDeviceStore.getState().setMetadata(fromRadio.metadata);
  }

  // Mark time-of-last-packet regardless of type — Debug screen uses this to
  // show staleness at a glance.
  useDeviceStore.getState().setLastPacketAt(Date.now());

  if (fromRadio.nodeInfo) {
    const { nodeInfo } = fromRadio;
    const isSelf = nodeInfo.num === myNodeNum;

    useCrewStore.getState().upsertMember({
      nodeId: nodeInfo.num,
      // || not ?? — an empty-string name from an unconfigured peer must fall
      // through to 'Unknown', otherwise the crew card renders blank.
      longName: nodeInfo.user?.longName || 'Unknown',
      shortName: nodeInfo.user?.shortName || '???',
      lastHeard: nodeInfo.lastHeard,
      batteryLevel: nodeInfo.deviceMetrics?.batteryLevel,
      isSelf,
      isOnline: true,
    });

    if (nodeInfo.snr !== undefined) {
      useCrewStore.getState().updateSnr(nodeInfo.num, nodeInfo.snr);
    }

    if (nodeInfo.position) {
      const { lat, lng } = latLngFromI(
        nodeInfo.position.latitudeI,
        nodeInfo.position.longitudeI,
      );
      // Ignore 0,0 coordinates (no GPS fix) and invalid/NaN values
      if ((lat !== 0 || lng !== 0) && !isNaN(lat) && !isNaN(lng)) {
        if (isSelf) {
          useCrewStore.getState().setMyLocation(lat, lng);
        } else {
          useCrewStore.getState().updateLocation(nodeInfo.num, lat, lng);
        }
      }
    }
  }

  if (fromRadio.packet) {
    const pkt = fromRadio.packet;
    // Liveness survives dedup: flood routing naturally delivers the same id
    // from multiple neighbors, and each copy still proves the peer is RF
    // reachable right now. Bump lastHeard before the dedup guard so a replay
    // or flood doesn't stale a peer out. Guard on myNodeNum so pre-myInfo
    // packets don't leak self-stubs.
    if (pkt.from && myNodeNum !== null && pkt.from !== myNodeNum) {
      useCrewStore.getState().touchLastHeard(
        pkt.from,
        pkt.rxTime ?? Math.floor(Date.now() / 1000),
      );
    }
    if (!isPacketDuplicate(pkt.id)) {
      routePacket(pkt, myNodeNum);
    }
  }
}

function routePacket(packet: MeshPacket, myNodeNum: number | null): void {
  if (!packet.decoded) return;

  if (packet.rxSnr !== undefined) {
    useCrewStore.getState().updateSnr(packet.from, packet.rxSnr);
  }

  const { portnum, payload } = packet.decoded;
  const crewMembers = useCrewStore.getState().crewMembers;
  const sender = crewMembers[packet.from];
  const fromName = sender?.longName ?? `Node ${packet.from.toString(16)}`;
  const timestamp = (packet.rxTime ?? Math.floor(Date.now() / 1000)) * 1000;

  switch (portnum) {
    case PortNum.TEXT_MESSAGE_APP: {
      const text = decodeTextMessage(payload);
      const message = parseMessage(text, packet.from, fromName, timestamp, packet.channel);

      if (message.type === 'color') {
        useCrewStore.getState().updateColor(packet.from, message.color);
        break;
      }

      useMessagesStore.getState().addMessage(message);

      if (message.type === 'going') {
        useScheduleStore.getState().addGoingEntry({
          nodeId: packet.from,
          nodeName: fromName,
          stageId: message.stageId,
          artistId: message.artistId,
          timestamp: Date.now(),
        });
      }

      if (message.type === 'calibration') {
        useMapCalibrationStore.getState().setAnchors(message.anchors);
      }

      if (message.type === 'tag') {
        useTagStore.getState().addTag({
          id: `tag-${packet.from}-${Date.now()}`,
          name: message.name,
          category: 'custom',
          scope: message.channelIndex === 1 ? 'community' : 'crew',
          lat: message.lat,
          lng: message.lng,
          createdBy: fromName,
          createdAt: Date.now(),
          confirmCount: 0,
        });
      }
      break;
    }

    case PortNum.POSITION_APP: {
      const pos = decodePosition(payload);
      const { lat, lng } = latLngFromI(pos.latitudeI, pos.longitudeI);
      // Ignore 0,0 coordinates (no GPS fix) and invalid/NaN values
      if ((lat !== 0 || lng !== 0) && !isNaN(lat) && !isNaN(lng)) {
        if (packet.from === myNodeNum) {
          useCrewStore.getState().setMyLocation(lat, lng);
        } else {
          useCrewStore.getState().updateLocation(packet.from, lat, lng);
        }
      }
      break;
    }

    case PortNum.TELEMETRY_APP: {
      const telemetry = decodeTelemetry(payload);
      if (telemetry.deviceMetrics?.batteryLevel !== undefined) {
        useCrewStore.getState().updateBattery(packet.from, telemetry.deviceMetrics.batteryLevel);
      }
      break;
    }
  }
}
