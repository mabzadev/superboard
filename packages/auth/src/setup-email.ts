import { escapeHtml } from "./invite.js";
import { generateTokenWithHash, hashToken } from "./tokens.js";
import { Role, type AuthAdapter, type EmailMessage, type User } from "./types.js";

const TOKEN_EXPIRY_MS = 15 * 60 * 1000;

export type AdminEmailSetupSendFn = (message: EmailMessage) => Promise<void>;

export interface AdminEmailSetupConfig {
	baseUrl: string;
	siteName: string;
	email: AdminEmailSetupSendFn;
}

export async function requestAdminEmailSetup(
	config: AdminEmailSetupConfig,
	adapter: AuthAdapter,
	email: string,
): Promise<void> {
	const normalizedEmail = email.trim().toLowerCase();
	if (await adapter.getUserByEmail(normalizedEmail)) {
		throw new AdminEmailSetupError("user_exists", "An account with this email already exists");
	}
	const { token, hash } = generateTokenWithHash();
	await adapter.createToken({
		hash,
		email: normalizedEmail,
		type: "email_verify",
		role: Role.ADMIN,
		expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS),
	});

	const url = new URL("/_emdash/api/setup/admin/email/verify", config.baseUrl);
	url.searchParams.set("token", token);
	const safeSiteName = escapeHtml(config.siteName);
 	try {
		await config.email({
			to: normalizedEmail,
			subject: `Finish setting up ${config.siteName}`,
			text: `Click this link to verify your email and create the administrator account for ${config.siteName}:\n\n${url.toString()}\n\nThis link expires in 15 minutes.\n\nIf you did not request this, you can safely ignore this email.`,
			html: `<!DOCTYPE html>
<html><body style="font-family: sans-serif; line-height: 1.5">
<h1>Finish setting up ${safeSiteName}</h1>
<p>Verify your email to create the administrator account.</p>
<p><a href="${url.toString()}">Verify email and finish setup</a></p>
<p>This link expires in 15 minutes.</p>
</body></html>`,
		});
	} catch (error) {
		await adapter.deleteToken(hash);
		throw error;
	}
}

export async function completeAdminEmailSetup(
	adapter: AuthAdapter,
	token: string,
	userData: { name?: string; expectedEmail: string },
): Promise<User> {
	const hash = hashToken(token);
	const authToken = await adapter.getToken(hash, "email_verify");
	if (
		!authToken ||
		authToken.expiresAt < new Date() ||
		!authToken.email ||
		authToken.role !== Role.ADMIN ||
		authToken.email !== userData.expectedEmail.trim().toLowerCase()
	) {
		throw new AdminEmailSetupError("invalid_token", "Invalid or expired setup link");
	}
	if (await adapter.getUserByEmail(authToken.email)) {
		await adapter.deleteToken(hash);
		throw new AdminEmailSetupError("user_exists", "An account with this email already exists");
	}

	await adapter.deleteToken(hash);
	return adapter.createUser({
		email: authToken.email,
		name: userData.name,
		role: Role.ADMIN,
		emailVerified: true,
	});
}

export class AdminEmailSetupError extends Error {
	constructor(
		public code: "invalid_token" | "user_exists",
		message: string,
	) {
		super(message);
		this.name = "AdminEmailSetupError";
	}
}
