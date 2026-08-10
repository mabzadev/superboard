#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
# Run `pod lib lint superboard_flutter.podspec` to validate before publishing.
#
require 'yaml'

flutter_pubspec_path = File.expand_path('../pubspec.yaml', __dir__)
flutter_pubspec = YAML.safe_load(
  File.open(flutter_pubspec_path, 'r:UTF-8', &:read),
  permitted_classes: [],
  aliases: false
)
unless flutter_pubspec.is_a?(Hash) && flutter_pubspec.key?('version')
  raise "SuperBoard Flutter pubspec does not declare a version: #{flutter_pubspec_path}"
end

flutter_sdk_version = flutter_pubspec['version'].to_s
unless flutter_sdk_version.match?(/\A[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\z/)
  raise 'SuperBoard Flutter version must be a CocoaPods-compatible semantic version without Dart build metadata'
end

Pod::Spec.new do |s|
  s.name             = 'superboard_flutter'
  s.version          = flutter_sdk_version
  s.summary          = 'SuperBoard SDK integration for Flutter.'
  s.description      = <<-DESC
SuperBoard Flutter SDK for links, messaging, attribution, and purchases.
                       DESC
  s.homepage         = 'https://github.com/mbzadev/superboard-platform'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'SuperBoard' => 'https://github.com/mbzadev/superboard-platform' }
  s.source           = { :path => '.' }
  # Embed the internal native SDK in the Flutter pod. EmbeddedOpenGrow contains
  # repository-relative file symlinks to the canonical sdks/ios sources. Files,
  # rather than the directory itself, are linked because CocoaPods does not
  # recurse through a symlinked source directory. The monorepo Git tag therefore
  # remains self-contained without publishing the internal SDK to CocoaPods.
  s.source_files = [
    'Classes/**/*',
    'EmbeddedOpenGrow/**/*.swift'
  ]
  s.resources = 'EmbeddedOpenGrow/**/*.{xib}'
  s.dependency 'Flutter'
  s.platform = :ios, '13.0'

  # Flutter.framework does not contain a i386 slice.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
  s.swift_version = '5.0'
end
