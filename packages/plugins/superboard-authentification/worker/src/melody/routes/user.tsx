import { Hono } from "hono";

import { routeConfig, typeConfig } from "../configs";
import { userHandler } from "../handlers";
import { authMiddleware } from "../middlewares";

const BaseRoute = routeConfig.InternalRoute.ApiUsers;
const userRoutes = new Hono<typeConfig.Context>();
export default userRoutes;

userRoutes.get(`${BaseRoute}`, authMiddleware.s2sReadUser, userHandler.getUsers);

userRoutes.get(`${BaseRoute}/:authId`, authMiddleware.s2sReadUser, userHandler.getUser);

userRoutes.get(
	`${BaseRoute}/:authId/locked-ips`,
	authMiddleware.s2sReadUser,
	userHandler.getUserLockedIPs,
);

userRoutes.delete(
	`${BaseRoute}/:authId/locked-ips`,
	authMiddleware.s2sWriteUser,
	userHandler.deleteUserLockedIPs,
);

userRoutes.put(`${BaseRoute}/:authId`, authMiddleware.s2sWriteUser, userHandler.putUser);

userRoutes.post(
	`${BaseRoute}/:authId/verify-email`,
	authMiddleware.s2sWriteUser,
	userHandler.verifyEmail,
);

userRoutes.delete(`${BaseRoute}/:authId`, authMiddleware.s2sWriteUser, userHandler.deleteUser);

userRoutes.get(
	`${BaseRoute}/:authId/consented-apps`,
	authMiddleware.s2sReadUser,
	userHandler.getUserAppConsents,
);

userRoutes.delete(
	`${BaseRoute}/:authId/consented-apps/:appId`,
	authMiddleware.s2sWriteUser,
	userHandler.deleteUserAppConsent,
);

userRoutes.get(
	`${BaseRoute}/:authId/passkeys`,
	authMiddleware.s2sReadUser,
	userHandler.getUserPasskeys,
);

userRoutes.delete(
	`${BaseRoute}/:authId/passkeys/:passkeyId`,
	authMiddleware.s2sWriteUser,
	userHandler.removeUserPasskey,
);

userRoutes.post(
	`${BaseRoute}/:authId/email-mfa`,
	authMiddleware.s2sWriteUser,
	userHandler.postUserEmailMfa,
);

userRoutes.delete(
	`${BaseRoute}/:authId/email-mfa`,
	authMiddleware.s2sWriteUser,
	userHandler.deleteUserEmailMfa,
);

userRoutes.post(
	`${BaseRoute}/:authId/otp-mfa`,
	authMiddleware.s2sWriteUser,
	userHandler.postUserOtpMfa,
);

userRoutes.delete(
	`${BaseRoute}/:authId/otp-mfa`,
	authMiddleware.s2sWriteUser,
	userHandler.deleteUserOtpMfa,
);

userRoutes.post(
	`${BaseRoute}/:authId/account-linking/:linkingAuthId`,
	authMiddleware.s2sWriteUser,
	userHandler.linkAccount,
);

userRoutes.delete(
	`${BaseRoute}/:authId/account-linking`,
	authMiddleware.s2sWriteUser,
	userHandler.unlinkAccount,
);

userRoutes.post(
	`${BaseRoute}/:authId/impersonation/:appId`,
	authMiddleware.s2sRoot,
	userHandler.impersonateUser,
);

userRoutes.get(
	`${BaseRoute}/:authId/active-sessions`,
	authMiddleware.s2sReadUser,
	userHandler.getUserActiveSessions,
);

userRoutes.delete(
	`${BaseRoute}/:authId/active-sessions/:sessionId`,
	authMiddleware.s2sWriteUser,
	userHandler.deleteUserActiveSession,
);

userRoutes.post(
	`${BaseRoute}/invitations/:authId`,
	authMiddleware.s2sWriteUser,
	userHandler.postResendUserInvitation,
);

userRoutes.delete(
	`${BaseRoute}/invitations/:authId`,
	authMiddleware.s2sWriteUser,
	userHandler.deleteUserInvitation,
);

userRoutes.post(
	`${BaseRoute}/invitations`,
	authMiddleware.s2sWriteUser,
	userHandler.postUserInvitation,
);
