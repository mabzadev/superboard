import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { embeddedHandler } from "../handlers";
import { captchaMiddleware, configMiddleware, setupMiddleware } from "../middlewares";

const embeddedRoutes = new Hono<typeConfig.Context>();
export default embeddedRoutes;

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.Initiate,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.initiate,
);

embeddedRoutes.get(
	routeConfig.EmbeddedRoute.SignUp,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enableSignUp,
	embeddedHandler.getSignUpInfo,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.SignUp,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enableSignUp,
	captchaMiddleware.requireCaptcha,
	embeddedHandler.signUp,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.SignIn,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enablePasswordSignIn,
	captchaMiddleware.requireCaptcha,
	embeddedHandler.signIn,
);

embeddedRoutes.get(
	routeConfig.EmbeddedRoute.AppConsent,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enableAppConsent,
	embeddedHandler.getAppConsent,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.AppConsent,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enableAppConsent,
	embeddedHandler.postAppConsent,
);

embeddedRoutes.get(
	routeConfig.EmbeddedRoute.MfaEnrollment,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.getMfaEnrollment,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.MfaEnrollment,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.postMfaEnrollment,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.EmailMfaCode,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.postEmailMfaCode,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.EmailMfa,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.postEmailMfa,
);

embeddedRoutes.get(
	routeConfig.EmbeddedRoute.OtpMfaSetup,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.getOtpMfaSetup,
);

embeddedRoutes.get(
	routeConfig.EmbeddedRoute.OtpMfa,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.getOtpMfa,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.OtpMfa,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.postOtpMfa,
);

embeddedRoutes.get(
	routeConfig.EmbeddedRoute.PasskeyEnroll,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enablePasskeyEnrollment,
	embeddedHandler.getPasskeyEnroll,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.PasskeyEnroll,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enablePasskeyEnrollment,
	embeddedHandler.postPasskeyEnroll,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.PasskeyEnrollDecline,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enablePasskeyEnrollment,
	embeddedHandler.postPasskeyEnrollDecline,
);

embeddedRoutes.get(
	routeConfig.EmbeddedRoute.PasskeyVerify,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enablePasskeyEnrollment,
	embeddedHandler.getPasskeyVerify,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.PasskeyVerify,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enablePasskeyEnrollment,
	embeddedHandler.postPasskeyVerify,
);

embeddedRoutes.get(
	routeConfig.EmbeddedRoute.RecoveryCodeEnroll,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enableRecoveryCode,
	embeddedHandler.getRecoveryCodeEnroll,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.RecoveryCode,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enableRecoveryCode,
	embeddedHandler.signInWithRecoveryCode,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.TokenExchange,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.tokenExchange,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.TokenRefresh,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.tokenRefresh,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.SignOut,
	setupMiddleware.validEmbeddedOrigin,
	embeddedHandler.signOut,
);

embeddedRoutes.post(
	routeConfig.EmbeddedRoute.ResetPasswordCode,
	setupMiddleware.validEmbeddedOrigin,
	configMiddleware.enablePasswordReset,
	embeddedHandler.resetPassword,
);
