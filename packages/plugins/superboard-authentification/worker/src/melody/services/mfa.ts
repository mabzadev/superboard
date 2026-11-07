import { genRandomString } from "@melody-auth/shared";
import { Context } from "hono";
import { env } from "hono/adapter";
import { setCookie } from "hono/cookie";

import { adapterConfig, errorConfig, messageConfig, routeConfig, typeConfig } from "../configs";
import { appModel, userModel } from "../models";
import { requestUtil, loggerUtil } from "../utils";
import * as emailService from "./email";
import * as kvService from "./kv";
import * as userService from "./user";

export interface MfaConfig {
	requireEmailMfa: boolean;
	requireOtpMfa: boolean;
	enforceOneMfaEnrollment: string[];
	allowEmailMfaAsBackup: boolean;
}

const getSystemMfaConfig = (c: Context<typeConfig.Context>): MfaConfig => {
	const {
		EMAIL_MFA_IS_REQUIRED: requireEmailMfa,
		OTP_MFA_IS_REQUIRED: requireOtpMfa,
		ENFORCE_ONE_MFA_ENROLLMENT: enforceOneMfaEnrollment,
		ALLOW_EMAIL_MFA_AS_BACKUP: allowEmailMfaAsBackup,
	} = env(c);

	return {
		requireEmailMfa,
		requireOtpMfa,
		enforceOneMfaEnrollment,
		allowEmailMfaAsBackup,
	};
};

export const getAppMfaConfig = (app: appModel.Record): MfaConfig | null => {
	if (!app.useSystemMfaConfig) {
		return {
			requireEmailMfa: app.requireEmailMfa,
			requireOtpMfa: app.requireOtpMfa,
			allowEmailMfaAsBackup: app.allowEmailMfaAsBackup,
			enforceOneMfaEnrollment: [],
		};
	}

	return null;
};

export const getAuthCodeBodyMfaConfig = (
	mfaConfig: MfaConfig,
): typeConfig.AuthCodeBodyMfaConfig => {
	return {
		e: mfaConfig.requireEmailMfa,
		o: mfaConfig.requireOtpMfa,
		b: mfaConfig.allowEmailMfaAsBackup,
	};
};

export const getAuthorizeMfaConfig = (
	c: Context<typeConfig.Context>,
	authCodeBody: typeConfig.AuthCodeBody | typeConfig.EmbeddedSessionBodyWithUser,
): MfaConfig => {
	if (authCodeBody.mfa) {
		return {
			requireEmailMfa: authCodeBody.mfa.e,
			requireOtpMfa: authCodeBody.mfa.o,
			allowEmailMfaAsBackup: authCodeBody.mfa.b,
			enforceOneMfaEnrollment: [],
		};
	}

	return getSystemMfaConfig(c);
};

export const allowOtpSwitchToEmailMfa = (
	c: Context<typeConfig.Context>,
	authCodeStore: typeConfig.AuthCodeBody | typeConfig.EmbeddedSessionBodyWithUser,
) => {
	const {
		requireEmailMfa: enableEmailMfa,
		requireOtpMfa: enableOtpMfa,
		allowEmailMfaAsBackup: allowFallback,
	} = getAuthorizeMfaConfig(c, authCodeStore);

	const notEnrolledEmail =
		!enableEmailMfa && !authCodeStore.user.mfaTypes.includes(userModel.MfaType.Email);
	const enrolledOtp = enableOtpMfa || authCodeStore.user.mfaTypes.includes(userModel.MfaType.Otp);

	return allowFallback && notEnrolledEmail && enrolledOtp;
};

export const handleSendEmailMfa = async (
	c: Context<typeConfig.Context>,
	authCode: string,
	authCodeBody: typeConfig.AuthCodeBody | typeConfig.EmbeddedSessionBodyWithUser,
	locale: typeConfig.Locale,
	isPasswordlessCode: boolean = false,
) => {
	const {
		EMAIL_MFA_EMAIL_THRESHOLD: threshold,
		ENABLE_PASSWORDLESS_SIGN_IN: enablePasswordlessSignIn,
		USE_PASSWORDLESS_AS_MAGIC_LINK: usePasswordlessAsMagicLink,
		AUTHORIZATION_CODE_EXPIRES_IN: codeExpiresIn,
		AUTH_SERVER_URL: serverUrl,
	} = env(c);

	const { requireEmailMfa: enableEmailMfa } = getAuthorizeMfaConfig(c, authCodeBody);

	const requireEmailMfa =
		enableEmailMfa || authCodeBody.user.mfaTypes.includes(userModel.MfaType.Email);
	const couldFallbackAsOtp = allowOtpSwitchToEmailMfa(c, authCodeBody);

	if (
		!authCodeBody.user.email ||
		(!requireEmailMfa && !couldFallbackAsOtp && !enablePasswordlessSignIn)
	) {
		loggerUtil.triggerLogger(
			c,
			loggerUtil.LoggerLevel.Error,
			messageConfig.ConfigError.NotSupposeToSendEmailMfa,
		);
		throw new errorConfig.Forbidden(messageConfig.ConfigError.NotSupposeToSendEmailMfa);
	}

	if (threshold) {
		const ip = requestUtil.getRequestIP(c);
		const attempts = await kvService.getEmailMfaEmailAttemptsByIP(
			c.env.KV,
			authCodeBody.user.id,
			ip,
		);
		if (attempts >= threshold) {
			loggerUtil.triggerLogger(
				c,
				loggerUtil.LoggerLevel.Warn,
				messageConfig.RequestError.EmailMfaLocked,
			);
			throw new errorConfig.Forbidden(messageConfig.RequestError.EmailMfaLocked);
		}

		await kvService.setEmailMfaEmailAttempts(c.env.KV, authCodeBody.user.id, ip, attempts + 1);
	}

	const isMagicLink = isPasswordlessCode && usePasswordlessAsMagicLink;
	let mfaCode: string | null;
	if (isMagicLink) {
		const displayLocale = locale || "en";
		const magicLinkBaseUrl = `${serverUrl}${routeConfig.IdentityRoute.ProcessView}?code=${authCode}&locale=${displayLocale}`;
		mfaCode = await emailService.sendMagicLinkEmail(
			c,
			authCodeBody.user.email,
			locale,
			magicLinkBaseUrl,
			{ appId: authCodeBody.appId, userId: authCodeBody.user.id },
		);
	} else {
		mfaCode = await emailService.sendEmailMfa(c, authCodeBody.user.email, locale, {
			appId: authCodeBody.appId,
			userId: authCodeBody.user.id,
		});
	}

	if (mfaCode) {
		if (isPasswordlessCode) {
			await kvService.storePasswordlessCode(c.env.KV, authCode, mfaCode, codeExpiresIn);
		} else {
			await kvService.storeEmailMfaCode(c.env.KV, authCode, mfaCode);
		}
	}

	return { result: true };
};

export const processEmailMfa = async (
	c: Context<typeConfig.Context>,
	authCode: string,
	authCodeStore: typeConfig.AuthCodeBody | typeConfig.EmbeddedSessionBodyWithUser,
	mfaCode: string,
) => {
	const isOtpFallback = allowOtpSwitchToEmailMfa(c, authCodeStore);

	const { AUTHORIZATION_CODE_EXPIRES_IN: expiresIn, MFA_CODE_VERIFY_THRESHOLD: threshold } = env(c);

	let ip: string | undefined;
	let failedAttempts = 0;
	if (threshold) {
		ip = requestUtil.getRequestIP(c);
		failedAttempts = await kvService.getFailedMfaCodeAttemptsByIP(
			c.env.KV,
			authCodeStore.user.id,
			ip,
		);
		if (failedAttempts >= threshold) {
			loggerUtil.triggerLogger(
				c,
				loggerUtil.LoggerLevel.Warn,
				messageConfig.RequestError.EmailMfaLocked,
			);
			throw new errorConfig.Forbidden(messageConfig.RequestError.EmailMfaLocked);
		}
	}

	const isValid = await kvService.stampEmailMfaCode(
		c.env.KV,
		authCode,
		mfaCode,
		expiresIn,
		isOtpFallback,
	);

	if (!isValid) {
		if (threshold) {
			await kvService.setFailedMfaCodeAttempts(
				c.env.KV,
				authCodeStore.user.id,
				ip,
				failedAttempts + 1,
			);
		}
		loggerUtil.triggerLogger(
			c,
			loggerUtil.LoggerLevel.Warn,
			messageConfig.RequestError.WrongEmailMfaCode,
		);
		throw new errorConfig.UnAuthorized(messageConfig.RequestError.WrongMfaCode);
	}
};

export const handleGetOtpMfaSetup = async (
	c: Context<typeConfig.Context>,
	authCodeStore: typeConfig.AuthCodeBody | typeConfig.EmbeddedSessionBodyWithUser,
) => {
	if (authCodeStore.user.otpVerified) {
		loggerUtil.triggerLogger(
			c,
			loggerUtil.LoggerLevel.Warn,
			messageConfig.RequestError.OtpAlreadySet,
		);
		throw new errorConfig.Forbidden(messageConfig.RequestError.OtpAlreadySet);
	}

	let otpSecret = authCodeStore.user.otpSecret;
	let user = null;
	if (!otpSecret) {
		user = await userService.genUserOtp(c, authCodeStore.user.id);

		otpSecret = user.otpSecret;
	}

	const otpUri = `otpauth://totp/${authCodeStore.appName}:${authCodeStore.user.email}?secret=${otpSecret}&issuer=melody-auth&algorithm=SHA1&digits=6&period=30`;

	return {
		otpUri,
		otpSecret,
		user,
	};
};

export const processOtpMfa = async (
	c: Context<typeConfig.Context>,
	authCode: string,
	authCodeStore: typeConfig.AuthCodeBody | typeConfig.EmbeddedSessionBodyWithUser,
	mfaCode: string,
) => {
	if (!authCodeStore.user.otpSecret) throw new errorConfig.Forbidden();

	const { AUTHORIZATION_CODE_EXPIRES_IN: expiresIn, MFA_CODE_VERIFY_THRESHOLD: threshold } = env(c);

	let ip: string | undefined;
	let failedAttempts = 0;
	if (threshold) {
		ip = requestUtil.getRequestIP(c);
		failedAttempts = await kvService.getFailedMfaCodeAttemptsByIP(
			c.env.KV,
			authCodeStore.user.id,
			ip,
		);
		if (failedAttempts >= threshold) {
			loggerUtil.triggerLogger(
				c,
				loggerUtil.LoggerLevel.Warn,
				messageConfig.RequestError.OtpMfaLocked,
			);
			throw new errorConfig.Forbidden(messageConfig.RequestError.OtpMfaLocked);
		}
	}

	const isValid = await kvService.stampOtpMfaCode(
		c.env.KV,
		authCode,
		mfaCode,
		authCodeStore.user.otpSecret,
		authCodeStore.user.id,
		expiresIn,
	);

	if (!isValid) {
		if (threshold) {
			await kvService.setFailedMfaCodeAttempts(
				c.env.KV,
				authCodeStore.user.id,
				ip,
				failedAttempts + 1,
			);
		}
		loggerUtil.triggerLogger(
			c,
			loggerUtil.LoggerLevel.Warn,
			messageConfig.RequestError.WrongOtpMfaCode,
		);
		throw new errorConfig.UnAuthorized(messageConfig.RequestError.WrongMfaCode);
	}

	if (!authCodeStore.user.otpVerified) {
		await userService.markOtpAsVerified(c, authCodeStore.user.id);
	}
};

export const getMfaEnrollmentInfo = async (
	c: Context<typeConfig.Context>,
	authCodeStore: typeConfig.AuthCodeBody | typeConfig.EmbeddedSessionBodyWithUser,
) => {
	if (authCodeStore.user.mfaTypes.length) {
		loggerUtil.triggerLogger(
			c,
			loggerUtil.LoggerLevel.Warn,
			messageConfig.RequestError.MfaEnrolled,
		);
		throw new errorConfig.Forbidden(messageConfig.RequestError.MfaEnrolled);
	}

	const { ENFORCE_ONE_MFA_ENROLLMENT: mfaTypes } = env(c);

	return { mfaTypes };
};

export const processMfaEnrollment = async (
	c: Context<typeConfig.Context>,
	authCodeStore: typeConfig.AuthCodeBody | typeConfig.EmbeddedSessionBodyWithUser,
	type: userModel.MfaType,
) => {
	if (authCodeStore.user.mfaTypes.length) {
		loggerUtil.triggerLogger(
			c,
			loggerUtil.LoggerLevel.Warn,
			messageConfig.RequestError.MfaEnrolled,
		);
		throw new errorConfig.Forbidden(messageConfig.RequestError.MfaEnrolled);
	}

	const user = await userService.enrollUserMfa(c, authCodeStore.user.authId, type);

	return user;
};

export const rememberEmailMfaDevice = async (
	c: Context<typeConfig.Context>,
	rememberDevice: boolean,
	userId: number,
) => {
	const { ENABLE_MFA_REMEMBER_DEVICE: enableMfaRememberDevice } = env(c);

	if (rememberDevice && enableMfaRememberDevice) {
		const deviceId = genRandomString(24);
		const cookieValue = genRandomString(128);

		const cookieKey = adapterConfig.getEmailMfaRememberDeviceCookieKey(userId);
		setCookie(c, cookieKey, `${deviceId}-${cookieValue}`, {
			httpOnly: true,
			secure: true,
			path: "/",
			expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			sameSite: "strict",
		});

		await kvService.storeEmailMfaRememberDevice(c.env.KV, userId, deviceId, cookieValue);
	}
};

export const rememberOtpMfaDevice = async (
	c: Context<typeConfig.Context>,
	rememberDevice: boolean,
	userId: number,
) => {
	const { ENABLE_MFA_REMEMBER_DEVICE: enableMfaRememberDevice } = env(c);

	if (rememberDevice && enableMfaRememberDevice) {
		const deviceId = genRandomString(24);
		const cookieValue = genRandomString(128);

		const cookieKey = adapterConfig.getOtpMfaRememberDeviceCookieKey(userId);
		setCookie(c, cookieKey, `${deviceId}-${cookieValue}`, {
			httpOnly: true,
			secure: true,
			path: "/",
			expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			sameSite: "strict",
		});

		await kvService.storeOtpMfaRememberDevice(c.env.KV, userId, deviceId, cookieValue);
	}
};
