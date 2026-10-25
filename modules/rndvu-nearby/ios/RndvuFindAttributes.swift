import ActivityKit
import Foundation

// KEEP IN SYNC with targets/find-activity/RndvuFindAttributes.swift.
// The app (which starts and updates the activity) and the widget (which
// draws it) are separate targets; ActivityKit matches them by this type's
// name and fields, so both copies must stay identical.
@available(iOS 16.1, *)
struct RndvuFindAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // Metres from UWB, or nil when not in precise range yet.
    var distance: Double?
    // searching | ranging | lost | paused
    var status: String
  }

  // "Ash is finding you" / "Finding Sam"
  var title: String
  // finder | helper
  var role: String
}
