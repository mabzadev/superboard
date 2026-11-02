import type { LinkRecord } from "./types.js";

export async function storeLink(kv: KVNamespace, record: LinkRecord): Promise<void> {
	const [existingByDiscord, existingByGitHub] = await Promise.all([
		findByDiscordId(kv, record.discord_id),
		findByGitHubId(kv, record.github_id),
	]);

	const deletes: Promise<void>[] = [];
	if (existingByDiscord && existingByDiscord.github_id !== record.github_id) {
		deletes.push(kv.delete(`github:${existingByDiscord.github_id}`));
	}
	if (existingByGitHub && existingByGitHub.discord_id !== record.discord_id) {
		deletes.push(kv.delete(`discord:${existingByGitHub.discord_id}`));
	}
	if (deletes.length > 0) {
		await Promise.all(deletes);
	}

	const value = JSON.stringify(record);
	await Promise.all([
		kv.put(`github:${record.github_id}`, value),
		kv.put(`discord:${record.discord_id}`, value),
	]);
}

export async function findByGitHubId(
	kv: KVNamespace,
	githubId: number,
): Promise<LinkRecord | null> {
	const value = await kv.get(`github:${githubId}`);
	if (!value) return null;
	const record: LinkRecord = JSON.parse(value);
	return record;
}

export async function findByDiscordId(
	kv: KVNamespace,
	discordId: string,
): Promise<LinkRecord | null> {
	const value = await kv.get(`discord:${discordId}`);
	if (!value) return null;
	const record: LinkRecord = JSON.parse(value);
	return record;
}

export async function isDeliveryProcessed(kv: KVNamespace, deliveryId: string): Promise<boolean> {
	return (await kv.get(`delivery:${deliveryId}`)) !== null;
}

export async function markDeliveryProcessed(kv: KVNamespace, deliveryId: string): Promise<void> {
	await kv.put(`delivery:${deliveryId}`, "1", {
		expirationTtl: 7 * 24 * 60 * 60,
	});
}

export async function storeOAuthState(
	kv: KVNamespace,
	state: string,
	data: { discord_id: string; discord_username: string },
): Promise<void> {
	await kv.put(`oauth:${state}`, JSON.stringify(data), {
		expirationTtl: 600,
	});
}

export async function consumeOAuthState(
	kv: KVNamespace,
	state: string,
): Promise<{ discord_id: string; discord_username: string } | null> {
	const value = await kv.get(`oauth:${state}`);
	if (!value) return null;
	await kv.delete(`oauth:${state}`);
	const data: { discord_id: string; discord_username: string } = JSON.parse(value);
	return data;
}

export async function recordContributor(
	kv: KVNamespace,
	githubId: number,
	githubLogin: string,
): Promise<void> {
	await kv.put(`contributor:${githubId}`, githubLogin);
}

export async function hasContributed(kv: KVNamespace, githubId: number): Promise<boolean> {
	return (await kv.get(`contributor:${githubId}`)) !== null;
}
