import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { EmDashClient } from "../../../../../packages/core/src/client/index.js";

const SESSION_COOKIE_REGEX = /^([^;]+)/;

const FIXTURE_DIR = resolve(import.meta.dirname, "../../../../fixtures/core-integration-site");
const DONOR_NODE_MODULES = resolve(
	import.meta.dirname,
	"../../../../fixtures/emdash-site/node_modules",
);
const SERVERS_BASE = resolve(import.meta.dirname, ".servers");

export interface TestServerOptions {
	port: number;
	timeout?: number;
	seed?: boolean;
	env?: Record<string, string>;
}

export interface TestServerContext {
	baseUrl: string;
	cwd: string;
	client: EmDashClient;
	token: string;
	collections: string[];
	contentIds: Record<string, string[]>;
	sessionCookie: string;
	cleanup: () => Promise<void>;
}

export function assertNodeVersion(): void {
	const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
	const ok = major! > 22 || (major === 22 && minor! >= 16);
	if (!ok) {
		throw new Error(
			`Integration tests require Node.js >= 22.16.0 (running ${process.versions.node}). ` +
				`Update your Node version instead of skipping tests.`,
		);
	}
}

const CLI_BINARY = resolve(import.meta.dirname, "../../../../../packages/core/dist/cli/index.mjs");

export async function ensureBuilt(): Promise<void> {
	if (!existsSync(CLI_BINARY)) {
		throw new Error("CLI binary missing after integration global setup");
	}
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
			if (res.status > 0) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

export async function createTestServer(options: TestServerOptions): Promise<TestServerContext> {
	const { port, timeout = 90_000, seed = true } = options;
	const baseUrl = `http://localhost:${port}`;

	await ensureBuilt();

	mkdirSync(SERVERS_BASE, { recursive: true });
	const workDir = mkdtempSync(join(SERVERS_BASE, "srv-"));
	cpSync(FIXTURE_DIR, workDir, {
		recursive: true,
		filter: (src) => !src.split(/[\\/]/).includes("node_modules"),
	});
	const dbPath = join(workDir, "test.db");
	const uploadsDir = join(workDir, "uploads");
	const viteCacheDir = join(workDir, ".vite-cache");
	mkdirSync(uploadsDir, { recursive: true });

	symlinkSync(DONOR_NODE_MODULES, join(workDir, "node_modules"));

	const astroBin = join(DONOR_NODE_MODULES, "astro", "bin", "astro.mjs");
	const server = spawn(process.execPath, [astroBin, "dev", "--port", String(port)], {
		cwd: workDir,
		env: {
			...process.env,
			ASTRO_DEV_BACKGROUND: "1",
			EMDASH_TEST_DB: `file:${dbPath}`,
			EMDASH_TEST_UPLOADS: uploadsDir,
			EMDASH_TEST_VITE_CACHE: viteCacheDir,
			...options.env,
		},
		stdio: "pipe",
	});

	let serverOutput = "";
	const MAX_OUTPUT = 5000;
	function appendOutput(chunk: string): void {
		if (process.env.DEBUG) process.stderr.write(`[integration:${port}] ${chunk}`);
		serverOutput += chunk;
		if (serverOutput.length > MAX_OUTPUT * 2) {
			serverOutput = serverOutput.slice(-MAX_OUTPUT);
		}
	}
	server.stdout?.on("data", (data: Buffer) => appendOutput(data.toString()));
	server.stderr?.on("data", (data: Buffer) => appendOutput(data.toString()));

	let stopped = false;

	async function cleanup(): Promise<void> {
		if (stopped) return;
		stopped = true;

		server.kill("SIGTERM");
		await new Promise((r) => setTimeout(r, 1000));

		if (!server.killed) {
			server.kill("SIGKILL");
			await new Promise((r) => setTimeout(r, 500));
		}

		rmSync(workDir, { recursive: true, force: true });
	}

	try {
		await waitForServer(`${baseUrl}/_emdash/api/setup/dev-bypass`, timeout);

		const setupRes = await fetch(`${baseUrl}/_emdash/api/setup/dev-bypass?token=1`);
		if (!setupRes.ok) {
			const body = await setupRes.text().catch(() => "");
			throw new Error(`Setup bypass failed (${setupRes.status}): ${body}`);
		}
		const setupJson = z
			.object({
				data: z.object({
					user: z.object({ id: z.string(), email: z.string() }),
					token: z.string().optional(),
				}),
			})
			.parse(await setupRes.json());
		const setupData = setupJson.data;
		const token = setupData.token;
		if (!token) {
			throw new Error("Setup bypass did not return a PAT token");
		}

		const setCookie = setupRes.headers.get("set-cookie");
		let sessionCookie = "";
		if (setCookie) {
			const match = setCookie.match(SESSION_COOKIE_REGEX);
			if (match) sessionCookie = match[1]!;
		}

		const client = new EmDashClient({
			baseUrl,
			token,
		});

		const collections: string[] = [];
		const contentIds: Record<string, string[]> = {};

		if (seed) {
			await seedTestData(client, collections, contentIds);
		}

		return {
			baseUrl,
			cwd: workDir,
			client,
			token,
			collections,
			contentIds,
			sessionCookie,
			cleanup,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		await cleanup();
		throw new Error(
			`${msg}\n\nServer output (last ${MAX_OUTPUT} chars):\n${serverOutput.slice(-MAX_OUTPUT)}`,
			{
				cause: error,
			},
		);
	}
}

async function seedTestData(
	client: EmDashClient,
	collections: string[],
	contentIds: Record<string, string[]>,
): Promise<void> {
	collections.push("posts");
	collections.push("pages");

	const postIds: string[] = [];

	const post1 = await client.create("posts", {
		data: {
			title: "First Post",
			body: "Hello **world**. This is the first post.",
			excerpt: "The very first post",
		},
		slug: "first-post",
	});
	postIds.push(post1.id);
	await client.publish("posts", post1.id);

	const post2 = await client.create("posts", {
		data: {
			title: "Second Post",
			body: "A second post with a [link](https://example.com).",
			excerpt: "Another post",
		},
		slug: "second-post",
	});
	postIds.push(post2.id);
	await client.publish("posts", post2.id);

	const post3 = await client.create("posts", {
		data: {
			title: "Draft Post",
			body: "This post is still a draft.",
			excerpt: "Not published yet",
		},
		slug: "draft-post",
	});
	postIds.push(post3.id);

	contentIds["posts"] = postIds;

	const pageIds: string[] = [];

	const page1 = await client.create("pages", {
		data: {
			title: "About",
			body: "# About Us\n\nWe are a **test** fixture.",
		},
		slug: "about",
	});
	pageIds.push(page1.id);
	await client.publish("pages", page1.id);

	const page2 = await client.create("pages", {
		data: {
			title: "Contact",
			body: "Get in touch.",
		},
		slug: "contact",
	});
	pageIds.push(page2.id);

	contentIds["pages"] = pageIds;
}
