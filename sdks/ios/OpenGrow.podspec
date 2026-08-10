Pod::Spec.new do |s|
  s.name         = 'OpenGrow'
  s.version      = '1.0.3'
  s.summary      = 'OpenGrow is a powerful SDK that enables deep linking and universal linking within your iOS applications.'
  s.homepage     = 'https://github.com/mbzadev/superboard-platform'
  s.license      = { :type => 'MIT', :file => 'LICENSE' }
  s.author       = { 'OpenGrow' => 'https://github.com/mbzadev/superboard-platform' }
  s.source       = { :git => 'https://github.com/mbzadev/superboard-platform.git', :tag => "sdk-ios-v#{s.version}" }
  s.swift_version = '5.9'
  s.module_name  = 'OpenGrow' 

  s.resources = 'sdks/ios/Sources/**/*.{xib}'
  s.source_files = 'sdks/ios/Sources/**/*.swift'

  s.platform     = :ios
  s.ios.deployment_target = "13.0"
end
