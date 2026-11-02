const DISCORD_API = "https://discord.com/api/v10";

export async function verifyDiscordSignature(
	request: Request,
	publicKey: string,
): Promise<boolean> {
	const signature = request.headers.get("X-Signature-Ed25519");
	const timestamp = request.headers.get("X-Signature-Timestamp");
	if (!signature || !timestamp) return false;

	const body = await request.clone().text();
	const encoder = new TextEncoder();

	const key = await crypto.subtle.importKey(
		"raw",
		hexToBytes(publicKey),
		{ name: "Ed25519", namedCurve: "Ed25519" },
		false,
		["verify"],
	);

	return crypto.subtle.verify(
		"Ed25519",
		key,
		hexToBytes(signature),
		encoder.encode(timestamp + body),
	);
}

export async function addRole(env: Env, userId: string, roleId: string): Promise<boolean> {
	const res = await fetch(
		`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`,
		{
			method: "PUT",
			headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
		},
	);
	return res.ok;
}

export async function hasRole(env: Env, userId: string, roleId: string): Promise<boolean> {
	const res = await fetch(`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, {
		headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
	});
	if (!res.ok) return false;
	const member: { roles: string[] } = await res.json();
	return member.roles.includes(roleId);
}

export async function postMessage(
	env: Env,
	channelId: string,
	content: string,
	mentionUserIds?: string[],
): Promise<boolean> {
	const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
		method: "POST",
		headers: {
			Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			content,
			allowed_mentions: {
				parse: [],
				users: mentionUserIds ?? [],
			},
		}),
	});
	return res.ok;
}

export function interactionResponse(content: string, ephemeral = false): Response {
	return Response.json({
		type: 4,
		data: {
			content,
			flags: ephemeral ? 64 : 0,
		},
	});
}

export function interactionResponseWithButton(
	content: string,
	buttonLabel: string,
	url: string,
): Response {
	return Response.json({
		type: 4,
		data: {
			content,
			flags: 64,
			components: [
				{
					type: 1,
					components: [
						{
							type: 2,
							style: 5,
							label: buttonLabel,
							url,
						},
					],
				},
			],
		},
	});
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}
