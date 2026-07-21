#ifdef RCT_NEW_ARCH_ENABLED
#import "../generated/RNOpenGrowWrapperSpec/RNOpenGrowWrapperSpec.h"
#import <React/RCTEventEmitter.h>

@interface OpenGrowWrapper : RCTEventEmitter <NativeOpenGrowWrapperSpec>

@end

#else

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface OpenGrowWrapper : RCTEventEmitter <RCTBridgeModule>

@end

#endif
