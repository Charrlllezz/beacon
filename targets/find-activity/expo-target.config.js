// The Find me Live Activity: lock screen and Dynamic Island while someone is
// finding you (or you them). Generated into the Xcode project at prebuild by
// @bacons/apple-targets.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'FindActivity',
  displayName: 'RNDVU Find',
  bundleIdentifier: '.findactivity',
  // Live Activities with ActivityContent need iOS 16.2.
  deploymentTarget: '16.2',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  colors: {
    $accent: '#ff8c42',
  },
};
