#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
# Run `pod lib lint opengrow_flutter.podspec` to validate before publishing.
#
require 'yaml'

flutter_pubspec_path = File.expand_path('../pubspec.yaml', __dir__)
flutter_pubspec = YAML.safe_load(
  File.open(flutter_pubspec_path, 'r:UTF-8', &:read),
  permitted_classes: [],
  aliases: false
)
unless flutter_pubspec.is_a?(Hash) && flutter_pubspec.key?('version')
  raise "OpenGrow Flutter pubspec does not declare a version: #{flutter_pubspec_path}"
end

flutter_sdk_version = flutter_pubspec['version'].to_s
unless flutter_sdk_version.match?(/\A[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\z/)
  raise 'OpenGrow Flutter version must be a CocoaPods-compatible semantic version without Dart build metadata'
end

Pod::Spec.new do |s|
  s.name             = 'opengrow_flutter'
  s.version          = flutter_sdk_version
  s.summary          = 'OpenGrow SDK integration for Flutter.'
  s.description      = <<-DESC
OpenGrow Flutter SDK for links, messaging, attribution, and purchases.
                       DESC
  s.homepage         = 'https://github.com/mbzadev/opengrow-platform'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'OpenGrow' => 'https://github.com/mbzadev/opengrow-platform' }
  s.source           = { :path => '.' }
  # Embed the native SDK in the Flutter pod. FlutterFlow can therefore build the
  # public Git dependency without access to a second CocoaPods repository.
  s.source_files = [
    'Classes/**/*',
    '../../ios/Sources/OpenGrow/**/*.swift'
  ]
  s.resources = '../../ios/Sources/OpenGrow/**/*.{xib}'
  s.dependency 'Flutter'
  s.platform = :ios, '13.0'

  # Flutter.framework does not contain a i386 slice.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
  s.swift_version = '5.0'
end
