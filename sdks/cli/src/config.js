import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { UsageError } from "./errors.js";

const SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{43}$/u;

function configPath(env) {
	const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(base, "superboard", "config.json");
}

export function normalizeUrl(value) {
	if (!value)
		throw new UsageError("Pass --url with the SDK origin, such as https://sdk.example.com.");
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new UsageError(
			`${value} is not a URL; pass the SDK origin, such as https://sdk.example.com.`,
		);
	}
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
		url.username ||
		url.password
	)
		throw new UsageError("Use an HTTPS SDK origin, or HTTP on loopback for local development.");
	return url.origin;
}

export function validateKey(value) {
	if (!SECRET_KEY_PATTERN.test(value ?? ""))
		throw new UsageError(
			"The server key starts with sb_secret_; create one in the SuperBoard Front.",
		);
	return value;
}

async function readConfig(env) {
	try {
		const parsed = JSON.parse(await readFile(configPath(env), "utf8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch (error) {
		if (error?.code === "ENOENT") return {};
		throw new UsageError(`${configPath(env)} is not valid JSON; run superboard login again.`);
	}
}

export async function writeConfig(env, config) {
	const path = configPath(env);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	await chmod(path, 0o600);
	return path;
}

export async function removeConfig(env) {
	const path = configPath(env);
	await rm(path, { force: true });
	return path;
}

export async function credentials(env) {
	const config = await readConfig(env);
	const url = env.SUPERBOARD_URL || config.url;
	const secretKey = env.SUPERBOARD_SECRET_KEY || config.secretKey;
	if (!url || !secretKey)
		throw new UsageError(
			"Not logged in. Run superboard login --url <sdk origin> --key <sb_secret_…>, or set SUPERBOARD_URL and SUPERBOARD_SECRET_KEY.",
		);
	return { url: normalizeUrl(url), secretKey: validateKey(secretKey) };
}
