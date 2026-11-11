import ActivityKit
import SwiftUI
import WidgetKit

// Lock screen + Dynamic Island for Find me. Tapping it opens RNDVU; "Stop"
// opens rndvu://find/stop, which ends the search or the sharing.

private let accent = Color(red: 1.0, green: 0.549, blue: 0.259) // #ff8c42

private func distanceText(_ state: RndvuFindAttributes.ContentState) -> String {
  if let d = state.distance {
    return d < 10 ? String(format: "%.1f m", d) : "\(Int(d.rounded())) m"
  }
  switch state.status {
  case "lost": return "Out of range"
  case "paused": return "Open RNDVU"
  default: return "Nearby…"
  }
}

private func detailText(_ context: ActivityViewContext<RndvuFindAttributes>) -> String {
  let state = context.state
  if state.distance != nil { return "Exact distance, Ultra Wideband" }
  if state.status == "paused" { return "Open RNDVU to keep measuring" }
  return context.attributes.role == "helper"
    ? "Sharing your spot. You can lock your phone."
    : "Measures exactly when you're within about 10 m"
}

struct FindActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RndvuFindAttributes.self) { context in
      // Lock screen / banner
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text(context.attributes.title)
            .font(.headline)
            .foregroundColor(.white)
          Text(detailText(context))
            .font(.caption)
            .foregroundColor(.gray)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 6) {
          Text(distanceText(context.state))
            .font(.system(size: 28, weight: .heavy, design: .rounded))
            .monospacedDigit()
            .foregroundColor(.white)
          Link(destination: URL(string: "rndvu://find/stop")!) {
            Text("Stop")
              .font(.caption.bold())
              .foregroundColor(accent)
          }
        }
      }
      .padding(16)
      .activityBackgroundTint(Color(red: 0.05, green: 0.05, blue: 0.094))
      .activitySystemActionForegroundColor(accent)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text(context.attributes.title)
            .font(.headline)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(distanceText(context.state))
            .font(.title2.bold())
            .monospacedDigit()
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Text(detailText(context))
              .font(.caption)
              .foregroundColor(.gray)
            Spacer()
            Link(destination: URL(string: "rndvu://find/stop")!) {
              Text("Stop").font(.caption.bold()).foregroundColor(accent)
            }
          }
        }
      } compactLeading: {
        Image(systemName: "location.north.fill")
          .foregroundColor(accent)
      } compactTrailing: {
        Text(distanceText(context.state))
          .monospacedDigit()
          .font(.caption2.bold())
      } minimal: {
        Image(systemName: "location.north.fill")
          .foregroundColor(accent)
      }
      .widgetURL(URL(string: "rndvu://find"))
    }
  }
}

@main
struct FindActivityBundle: WidgetBundle {
  var body: some Widget {
    FindActivityWidget()
  }
}
