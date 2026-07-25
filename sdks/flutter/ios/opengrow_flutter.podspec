#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
# Run `pod lib lint opengrow_flutter.podspec` to validate before publishing.
#
Pod::Spec.new do |s|
  s.name             = 'opengrow_flutter'
  s.version          = '1.1.0'
  s.summary          = 'OpenGrow SDK integration for Flutter.'
  s.description      = <<-DESC
Private Flutter SDK for OpenGrow links, messaging, attribution, and purchases.
                       DESC
  s.homepage         = 'https://github.com/mbzadev/opengrow'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'OpenGrow' => 'support@vocostar.com' }
  s.source           = { :path => '.' }
  # Embed the private native SDK in the Flutter pod. FlutterFlow can therefore
  # build the Git dependency without access to a second private CocoaPods repo.
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
