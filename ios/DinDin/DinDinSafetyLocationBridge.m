#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DinDinSafetyLocation, NSObject)
RCT_EXTERN_METHOD(configure:(NSString *)apiBaseUrl token:(NSString *)token)
RCT_EXTERN_METHOD(clearConfiguration)
@end
