Pod::Spec.new do |s|
  s.name           = 'RndvuNearby'
  s.version        = '1.0.0'
  s.summary        = 'Ultra Wideband precise finding between two RNDVU phones'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'RNDVU'
  s.homepage       = 'https://github.com/Charrlllezz/beacon'
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Charrlllezz/beacon.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'NearbyInteraction', 'MultipeerConnectivity'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
