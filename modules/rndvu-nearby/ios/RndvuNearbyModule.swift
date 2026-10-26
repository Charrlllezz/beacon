import ActivityKit
import ExpoModulesCore
import MultipeerConnectivity
import NearbyInteraction
import UIKit

// Ultra Wideband "precise find" between two RNDVU phones, like Find My's
// "Find Nearby": exact distance and, when the phones can see each other,
// direction, many times a second.
//
// Two phones range only after swapping Nearby Interaction discovery tokens.
// There's no internet at a festival, so the swap goes over a direct
// phone-to-phone link (MultipeerConnectivity: Bluetooth / peer-to-peer
// Wi-Fi), whose range is about the same as UWB's. Each phone advertises
// "I'm <my node> looking for <their node>" and only pairs with the one
// person it's looking for, who must be looking for it too.
//
// With an activity title, it also shows a Live Activity (lock screen and
// Dynamic Island) and updates it from here, not from JS: on iOS 18.4+ a Live
// Activity started before the app goes to the background keeps UWB ranging
// while the phone is locked, and JS is paused then.

public class RndvuNearbyModule: Module {
  private var finder: NearbyFinder?

  public func definition() -> ModuleDefinition {
    Name("RndvuNearby")

    Events("onRange")

    Function("capabilities") { () -> [String: Bool] in
      if #available(iOS 16.0, *) {
        let c = NISession.deviceCapabilities
        return [
          "distance": c.supportsPreciseDistanceMeasurement,
          "direction": c.supportsDirectionMeasurement,
          "cameraAssist": c.supportsCameraAssistance,
        ]
      }
      let ok = NISession.isSupported
      return ["distance": ok, "direction": ok, "cameraAssist": false]
    }

    AsyncFunction("start") { (myNodeId: Int, peerNodeId: Int, activityTitle: String?, role: String?) in
      self.finder?.stop()
      let finder = NearbyFinder(me: myNodeId, peer: peerNodeId, activityTitle: activityTitle, role: role ?? "finder") { [weak self] payload in
        self?.sendEvent("onRange", payload)
      }
      self.finder = finder
      finder.start()
    }.runOnQueue(.main)

    AsyncFunction("stop") {
      self.finder?.stop()
      self.finder = nil
    }.runOnQueue(.main)

    OnDestroy {
      self.finder?.stop()
      self.finder = nil
    }
  }
}

final class NearbyFinder: NSObject {
  // Bonjour service name: ≤15 characters, lowercase letters, digits, hyphens.
  // Must match NSBonjourServices in app.json.
  static let serviceType = "rndvu-ni"

  // A search never runs longer than this, even if JS never says stop (it
  // may be paused for the whole time on a locked phone).
  static let maxDuration: TimeInterval = 10 * 60

  private let me: Int
  private let peer: Int
  private let activityTitle: String?
  private let role: String
  private let emit: ([String: Any]) -> Void
  private var activity: Any?  // Activity<RndvuFindAttributes> on iOS 16.2+
  private var lastActivityUpdate = Date.distantPast
  private var lastActivityStatus = ""
  private var autoStop: DispatchWorkItem?

  private var ni: NISession?
  private var peerConfig: NINearbyPeerConfiguration?
  private let peerID: MCPeerID
  private let mc: MCSession
  private let advertiser: MCNearbyServiceAdvertiser
  private let browser: MCNearbyServiceBrowser
  private var running = false

  init(me: Int, peer: Int, activityTitle: String?, role: String, emit: @escaping ([String: Any]) -> Void) {
    self.me = me
    self.peer = peer
    self.activityTitle = activityTitle
    self.role = role
    self.emit = emit
    peerID = MCPeerID(displayName: String(me))
    mc = MCSession(peer: peerID, securityIdentity: nil, encryptionPreference: .required)
    advertiser = MCNearbyServiceAdvertiser(
      peer: peerID,
      discoveryInfo: ["n": String(me), "w": String(peer)],
      serviceType: NearbyFinder.serviceType
    )
    browser = MCNearbyServiceBrowser(peer: peerID, serviceType: NearbyFinder.serviceType)
    super.init()
    mc.delegate = self
    advertiser.delegate = self
    browser.delegate = self
  }

  // Low Power Mode or under 20%: skip UWB and the Live Activity. The search
  // still works on GPS; someone else's search shouldn't drain a low phone.
  static func batteryAllows() -> Bool {
    if ProcessInfo.processInfo.isLowPowerModeEnabled { return false }
    UIDevice.current.isBatteryMonitoringEnabled = true
    let level = UIDevice.current.batteryLevel // -1 when unknown
    return level < 0 || level >= 0.2
  }

  func start() {
    guard NISession.isSupported else {
      emit(["state": "unsupported"])
      return
    }
    guard NearbyFinder.batteryAllows() else {
      emit(["state": "lowPower"])
      return
    }
    running = true
    if activityTitle != nil { startActivity() }
    let stopper = DispatchWorkItem { [weak self] in
      guard let self = self, self.running else { return }
      self.emit(["state": "ended"])
      self.stop()
    }
    autoStop = stopper
    DispatchQueue.main.asyncAfter(deadline: .now() + NearbyFinder.maxDuration, execute: stopper)
    let session = NISession()
    session.delegate = self
    ni = session
    advertiser.startAdvertisingPeer()
    browser.startBrowsingForPeers()
    emit(["state": "searching"])
  }

  func stop() {
    running = false
    autoStop?.cancel()
    autoStop = nil
    endActivity()
    advertiser.stopAdvertisingPeer()
    browser.stopBrowsingForPeers()
    mc.disconnect()
    ni?.invalidate()
    ni = nil
    peerConfig = nil
  }

  // MARK: Live Activity

  private func startActivity() {
    guard #available(iOS 16.2, *), let title = activityTitle else { return }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let attributes = RndvuFindAttributes(title: title, role: role)
    let state = RndvuFindAttributes.ContentState(distance: nil, status: "searching")
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(NearbyFinder.maxDuration))
    activity = try? Activity.request(attributes: attributes, content: content, pushType: nil)
  }

  // At most once a second, except when the status changes.
  fileprivate func updateActivity(distance: Double?, status: String) {
    guard #available(iOS 16.2, *) else { return }
    guard let activity = activity as? Activity<RndvuFindAttributes> else { return }
    let now = Date()
    if status == lastActivityStatus && now.timeIntervalSince(lastActivityUpdate) < 1 { return }
    lastActivityUpdate = now
    lastActivityStatus = status
    let state = RndvuFindAttributes.ContentState(distance: distance, status: status)
    Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
  }

  private func endActivity() {
    guard #available(iOS 16.2, *) else { return }
    guard let activity = activity as? Activity<RndvuFindAttributes> else { return }
    self.activity = nil
    Task { await activity.end(nil, dismissalPolicy: .immediate) }
  }

  private func sendToken() {
    guard running, let token = ni?.discoveryToken, !mc.connectedPeers.isEmpty,
          let data = try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true)
    else { return }
    try? mc.send(data, toPeers: mc.connectedPeers, with: .reliable)
  }

  private func runPeer(token: NIDiscoveryToken) {
    guard running, let session = ni else { return }
    let config = NINearbyPeerConfiguration(peerToken: token)
    if #available(iOS 16.0, *) {
      // iPhone 14 and later work out direction with help from the camera
      // (ARKit); without it, direction can stay empty on those phones.
      if NISession.deviceCapabilities.supportsCameraAssistance {
        config.isCameraAssistanceEnabled = true
      }
    }
    if #available(iOS 17.0, *) {
      // Two iPhone 15 or later: ranging from much further away.
      if NISession.deviceCapabilities.supportsExtendedDistanceMeasurement {
        config.isExtendedDistanceMeasurementEnabled = true
      }
    }
    peerConfig = config
    session.run(config)
    emit(["state": "ranging"])
  }
}

// MARK: - Nearby Interaction

extension NearbyFinder: NISessionDelegate {
  func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
    guard let object = nearbyObjects.first else { return }
    var payload: [String: Any] = ["state": "ranging"]
    if let distance = object.distance {
      payload["distance"] = Double(distance)
    }
    // Radians, 0 = straight ahead of the phone, positive = to the right.
    // Already relative to the phone, so no compass is involved.
    var azimuth: Float?
    if #available(iOS 16.0, *), let angle = object.horizontalAngle {
      azimuth = angle
    }
    if azimuth == nil, let direction = object.direction {
      azimuth = asin(direction.x)
    }
    if let azimuth = azimuth {
      payload["azimuth"] = Double(azimuth)
    }
    emit(payload)
    updateActivity(distance: object.distance.map { Double($0) }, status: "ranging")
  }

  func session(_ session: NISession, didRemove nearbyObjects: [NINearbyObject], reason: NINearbyObject.RemovalReason) {
    switch reason {
    case .peerEnded:
      emit(["state": "ended"])
    case .timeout:
      // Out of range or blocked: keep trying with the same peer.
      emit(["state": "lost"])
      updateActivity(distance: nil, status: "lost")
      if let config = peerConfig { session.run(config) }
    @unknown default:
      emit(["state": "lost"])
    }
  }

  func sessionWasSuspended(_ session: NISession) {
    // Before iOS 18.4 (or without the Live Activity) a locked phone pauses
    // UWB; the activity says to open RNDVU.
    emit(["state": "suspended"])
    updateActivity(distance: nil, status: "paused")
  }

  func sessionSuspensionEnded(_ session: NISession) {
    if let config = peerConfig { session.run(config) }
  }

  func session(_ session: NISession, didInvalidateWith error: Error) {
    emit(["state": "error", "message": error.localizedDescription])
  }

  @available(iOS 16.0, *)
  func session(_ session: NISession, didUpdateAlgorithmConvergence convergence: NIAlgorithmConvergence, for object: NINearbyObject?) {
    // With camera assistance, direction needs the phone moved a little first.
    switch convergence.status {
    case .converged:
      emit(["state": "ranging", "converged": true])
    case .notConverged:
      emit(["state": "ranging", "converged": false])
    case .unknown:
      break
    @unknown default:
      break
    }
  }
}

// MARK: - Token swap over a direct phone-to-phone link

extension NearbyFinder: MCNearbyServiceBrowserDelegate {
  func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
    // Only the person we're finding, and only if they're finding us. The
    // lower node id sends the invitation so the two don't cross.
    guard info?["n"] == String(peer), info?["w"] == String(me), me < peer else { return }
    browser.invitePeer(peerID, to: mc, withContext: nil, timeout: 15)
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {}
}

extension NearbyFinder: MCNearbyServiceAdvertiserDelegate {
  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
    invitationHandler(peerID.displayName == String(peer), mc)
  }
}

extension NearbyFinder: MCSessionDelegate {
  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    DispatchQueue.main.async {
      switch state {
      case .connected:
        self.sendToken()
      case .notConnected:
        if self.running && self.peerConfig == nil { self.emit(["state": "searching"]) }
      default:
        break
      }
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    guard peerID.displayName == String(peer),
          let token = try? NSKeyedUnarchiver.unarchivedObject(ofClass: NIDiscoveryToken.self, from: data)
    else { return }
    DispatchQueue.main.async { self.runPeer(token: token) }
  }

  func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
  func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
  func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
