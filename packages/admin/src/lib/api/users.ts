import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import {
	API_BASE,
	apiFetch,
	parseApiResponse,
	throwResponseError,
	type FindManyResult,
} from "./client.js";

export interface UserListItem {
	id: string;
	email: string;
	name: string | null;
	avatarUrl: string | null;
	role: number;
	emailVerified: boolean;
	disabled: boolean;
	createdAt: string;
	updatedAt: string;
	lastLogin: string | null;
	credentialCount: number;
	oauthProviders: string[];
}

export interface UserDetail extends UserListItem {
	credentials: Array<{
		id: string;
		name: string | null;
		deviceType: string;
		createdAt: string;
		lastUsedAt: string;
	}>;
	oauthAccounts: Array<{
		provider: string;
		createdAt: string;
	}>;
}

export interface UpdateUserInput {
	name?: string;
	email?: string;
	role?: number;
}

export async function fetchUsers(options?: {
	search?: string;
	role?: number;
	cursor?: string;
	limit?: number;
}): Promise<FindManyResult<UserListItem>> {
	const params = new URLSearchParams();
	if (options?.search) params.set("search", options.search);
	if (options?.role !== undefined) params.set("role", String(options.role));
	if (options?.cursor) params.set("cursor", options.cursor);
	if (options?.limit) params.set("limit", String(options.limit));

	const url = `${API_BASE}/admin/users${params.toString() ? `?${params}` : ""}`;
	const response = await apiFetch(url);
	return parseApiResponse<FindManyResult<UserListItem>>(response, "Failed to fetch users");
}

export async function fetchUser(id: string): Promise<UserDetail> {
	const response = await apiFetch(`${API_BASE}/admin/users/${id}`);

	if (!response.ok) {
		if (response.status === 404) {
			throw new Error(`User not found: ${id}`);
		}
		await throwResponseError(response, i18n._(msg`Failed to fetch user`));
	}

	const data = await parseApiResponse<{ item: UserDetail }>(
		response,
		i18n._(msg`Failed to fetch user`),
	);
	return data.item;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserDetail> {
	const response = await apiFetch(`${API_BASE}/admin/users/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const data = await parseApiResponse<{ item: UserDetail }>(response, "Failed to update user");
	return data.item;
}

export async function disableUser(id: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/admin/users/${id}/disable`, {
		method: "POST",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to disable user`));
}

export async function sendRecoveryLink(id: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/admin/users/${id}/send-recovery`, {
		method: "POST",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to send recovery link`));
}

export async function enableUser(id: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/admin/users/${id}/enable`, {
		method: "POST",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to enable user`));
}

export interface InviteResult {
	success: true;
	message: string;
	inviteUrl?: string;
}

export async function inviteUser(email: string, role?: number): Promise<InviteResult> {
	const response = await apiFetch(`${API_BASE}/auth/invite`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, role }),
	});
	return parseApiResponse<InviteResult>(response, "Failed to invite user");
}

export interface InviteVerifyResult {
	email: string;
	role: number;
	roleName: string;
}

export async function validateInviteToken(token: string): Promise<InviteVerifyResult> {
	const response = await apiFetch(
		`${API_BASE}/auth/invite/accept?token=${encodeURIComponent(token)}`,
	);

	if (!response.ok) {
		const errorData: unknown = await response.json().catch(() => ({}));
		let message = `Invite validation failed: ${response.statusText}`;
		let code: string | undefined;
		if (typeof errorData === "object" && errorData !== null && "error" in errorData) {
			const err = errorData.error;
			if (typeof err === "object" && err !== null) {
				if ("message" in err && typeof err.message === "string") message = err.message;
				if ("code" in err && typeof err.code === "string") code = err.code;
			}
		}
		const error: Error & { code?: string } = new Error(message);
		error.code = code;
		throw error;
	}

	return parseApiResponse<InviteVerifyResult>(response, "Invite validation failed");
}

export interface PasskeyInfo {
	id: string;
	name: string | null;
	deviceType: "singleDevice" | "multiDevice";
	backedUp: boolean;
	createdAt: string;
	lastUsedAt: string;
}

export async function fetchPasskeys(): Promise<PasskeyInfo[]> {
	const response = await apiFetch(`${API_BASE}/auth/passkey`);
	const data = await parseApiResponse<{ items: PasskeyInfo[] }>(
		response,
		"Failed to fetch passkeys",
	);
	return data.items;
}

export async function renamePasskey(id: string, name: string): Promise<PasskeyInfo> {
	const response = await apiFetch(`${API_BASE}/auth/passkey/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
	const data = await parseApiResponse<{ passkey: PasskeyInfo }>(
		response,
		"Failed to rename passkey",
	);
	return data.passkey;
}

export async function deletePasskey(id: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/auth/passkey/${id}`, {
		method: "DELETE",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to delete passkey`));
}

export interface AllowedDomain {
	domain: string;
	defaultRole: number;
	roleName: string;
	enabled: boolean;
	createdAt: string;
}

export interface CreateAllowedDomainInput {
	domain: string;
	defaultRole: number;
}

export interface UpdateAllowedDomainInput {
	enabled?: boolean;
	defaultRole?: number;
}

export async function fetchAllowedDomains(): Promise<AllowedDomain[]> {
	const response = await apiFetch(`${API_BASE}/admin/allowed-domains`);
	const data = await parseApiResponse<{ domains: AllowedDomain[] }>(
		response,
		"Failed to fetch allowed domains",
	);
	return data.domains;
}

export async function createAllowedDomain(input: CreateAllowedDomainInput): Promise<AllowedDomain> {
	const response = await apiFetch(`${API_BASE}/admin/allowed-domains`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const data = await parseApiResponse<{ domain: AllowedDomain }>(
		response,
		"Failed to create allowed domain",
	);
	return data.domain;
}

export async function updateAllowedDomain(
	domain: string,
	input: UpdateAllowedDomainInput,
): Promise<AllowedDomain> {
	const response = await apiFetch(
		`${API_BASE}/admin/allowed-domains/${encodeURIComponent(domain)}`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
	);
	const data = await parseApiResponse<{ domain: AllowedDomain }>(
		response,
		"Failed to update allowed domain",
	);
	return data.domain;
}

export async function deleteAllowedDomain(domain: string): Promise<void> {
	const response = await apiFetch(
		`${API_BASE}/admin/allowed-domains/${encodeURIComponent(domain)}`,
		{
			method: "DELETE",
		},
	);
	if (!response.ok)
		await throwResponseError(response, i18n._(msg`Failed to delete allowed domain`));
}

export interface SignupVerifyResult {
	email: string;
	role: number;
	roleName: string;
}

export async function requestSignup(email: string): Promise<{ success: true; message: string }> {
	const response = await apiFetch(`${API_BASE}/auth/signup/request`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email }),
	});
	return parseApiResponse<{ success: true; message: string }>(response, "Signup request failed");
}

export async function verifySignupToken(token: string): Promise<SignupVerifyResult> {
	const response = await apiFetch(
		`${API_BASE}/auth/signup/verify?token=${encodeURIComponent(token)}`,
	);

	if (!response.ok) {
		const errorData: unknown = await response.json().catch(() => ({}));
		let message = `Token verification failed: ${response.statusText}`;
		let code: string | undefined;
		if (typeof errorData === "object" && errorData !== null && "error" in errorData) {
			const err = errorData.error;
			if (typeof err === "object" && err !== null) {
				if ("message" in err && typeof err.message === "string") message = err.message;
				if ("code" in err && typeof err.code === "string") code = err.code;
			}
		}
		const error: Error & { code?: string } = new Error(message);
		error.code = code;
		throw error;
	}

	return parseApiResponse<SignupVerifyResult>(response, "Token verification failed");
}

export async function completeSignup(
	token: string,
	credential: unknown,
	name?: string,
): Promise<{
	success: true;
	user: { id: string; email: string; name: string | null; role: number };
}> {
	const response = await apiFetch(`${API_BASE}/auth/signup/complete`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token, credential, name }),
	});

	if (!response.ok) {
		const errorData: unknown = await response.json().catch(() => ({}));
		let message = `Signup completion failed: ${response.statusText}`;
		let code: string | undefined;
		if (typeof errorData === "object" && errorData !== null && "error" in errorData) {
			const err = errorData.error;
			if (typeof err === "object" && err !== null) {
				if ("message" in err && typeof err.message === "string") message = err.message;
				if ("code" in err && typeof err.code === "string") code = err.code;
			}
		}
		const error: Error & { code?: string } = new Error(message);
		error.code = code;
		throw error;
	}

	return parseApiResponse<{
		success: true;
		user: { id: string; email: string; name: string | null; role: number };
	}>(response, "Signup completion failed");
}

export async function hasAllowedDomains(): Promise<boolean> {
	try {
		const domains = await fetchAllowedDomains();
		return domains.some((d) => d.enabled);
	} catch {
		return false;
	}
}
