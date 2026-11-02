import { generateTokenWithHash, hashToken } from "./tokens.js";
import type { AuthAdapter, RoleLevel, EmailMessage, User } from "./types.js";

export function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export type EmailSendFn = (message: EmailMessage) => Promise<void>;

export interface InviteConfig {
	baseUrl: string;
	siteName: string;
	email?: EmailSendFn;
}

export interface InviteTokenResult {
	url: string;
	email: string;
}

export async function createInviteToken(
	config: Pick<InviteConfig, "baseUrl">,
	adapter: AuthAdapter,
	email: string,
	role: RoleLevel,
	invitedBy: string,
): Promise<InviteTokenResult> {
	const existing = await adapter.getUserByEmail(email);
	if (existing) {
		throw new InviteError("user_exists", "A user with this email already exists");
	}

	const { token, hash } = generateTokenWithHash();

	await adapter.createToken({
		hash,
		email,
		type: "invite",
		role,
		invitedBy,
		expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS),
	});

	const url = new URL(`${config.baseUrl}/admin/invite/accept`);
	url.searchParams.set("token", token);
	return { url: url.toString(), email };
}

function buildInviteEmail(inviteUrl: string, email: string, siteName: string): EmailMessage {
	const safeName = escapeHtml(siteName);
	return {
		to: email,
		subject: `You've been invited to ${siteName}`,
		text: `You've been invited to join ${siteName}.\n\nClick this link to create your account:\n${inviteUrl}\n\nThis link expires in 7 days.`,
		html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="font-size: 24px; margin-bottom: 20px;">You've been invited to ${safeName}</h1>
  <p>Click the button below to create your account:</p>
  <p style="margin: 30px 0;">
    <a href="${inviteUrl}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Accept Invite</a>
  </p>
  <p style="color: #666; font-size: 14px;">This link expires in 7 days.</p>
</body>
</html>`,
	};
}

export async function createInvite(
	config: InviteConfig,
	adapter: AuthAdapter,
	email: string,
	role: RoleLevel,
	invitedBy: string,
): Promise<InviteTokenResult> {
	const result = await createInviteToken(config, adapter, email, role, invitedBy);

	if (config.email) {
		const message = buildInviteEmail(result.url, email, config.siteName);
		await config.email(message);
	}

	return result;
}

export async function validateInvite(
	adapter: AuthAdapter,
	token: string,
): Promise<{ email: string; role: RoleLevel }> {
	const hash = hashToken(token);

	const authToken = await adapter.getToken(hash, "invite");
	if (!authToken) {
		throw new InviteError("invalid_token", "Invalid or expired invite link");
	}

	if (authToken.expiresAt < new Date()) {
		await adapter.deleteToken(hash);
		throw new InviteError("token_expired", "This invite has expired");
	}

	if (!authToken.email || authToken.role === null) {
		throw new InviteError("invalid_token", "Invalid invite data");
	}

	return {
		email: authToken.email,
		role: authToken.role,
	};
}

export async function completeInvite(
	adapter: AuthAdapter,
	token: string,
	userData: {
		name?: string;
		avatarUrl?: string;
	},
): Promise<User> {
	const hash = hashToken(token);

	const authToken = await adapter.getToken(hash, "invite");
	if (!authToken || authToken.expiresAt < new Date()) {
		throw new InviteError("invalid_token", "Invalid or expired invite");
	}

	if (!authToken.email || authToken.role === null) {
		throw new InviteError("invalid_token", "Invalid invite data");
	}

	await adapter.deleteToken(hash);

	const user = await adapter.createUser({
		email: authToken.email,
		name: userData.name,
		avatarUrl: userData.avatarUrl,
		role: authToken.role,
		emailVerified: true,
	});

	return user;
}

export class InviteError extends Error {
	constructor(
		public code: "invalid_token" | "token_expired" | "user_exists",
		message: string,
	) {
		super(message);
		this.name = "InviteError";
	}
}
