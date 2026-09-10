#ifdef RCT_NEW_ARCH_ENABLED
#import "../generated/RNSuperBoardWrapperSpec/RNSuperBoardWrapperSpec.h"
#import <React/RCTEventEmitter.h>

@interface SuperBoardWrapper : RCTEventEmitter <NativeSuperBoardWrapperSpec>

@end

#else

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface SuperBoardWrapper : RCTEventEmitter <RCTBridgeModule>

@end

#endif
