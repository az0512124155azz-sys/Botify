Pod::Spec.new do |s|
  s.name = 'BotHubTdlib'
  s.version = '0.4.0'
  s.summary = 'BotHub TDLib transport'
  s.description = 'Native TDLib JSON interface, with a single process-wide receiver.'
  s.license = 'BSL-1.0'
  s.author = 'BotHub'
  s.homepage = 'https://github.com/az0512124155azz-sys/Botify'
  s.source = { :git => s.homepage }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.vendored_frameworks = 'libtdjson.xcframework'
  s.libraries = 'c++', 'z'
  s.resource_bundles = { 'BotHubTdlibLicense' => ['TDLib-LICENSE.txt'] }
end
