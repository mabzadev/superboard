import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_INFO_PATH = join(tmpdir(), "emdash-pw-server.json");
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const FIXTURE_DIR = resolve(ROOT, "tests/fixtures/emdash-site");

export default async function globalTeardown(): Promise<void> {
	if (!existsSync(SERVER_INFO_PATH)) return;

	try {
		const info = JSON.parse(readFileSync(SERVER_INFO_PATH, "utf-8"));

		try {
			process.kill(info.pid, "SIGTERM");
			await new Promise((r) => setTimeout(r, 1000));
			try {
				process.kill(info.pid, 0);
				process.kill(info.pid, "SIGKILL");
			} catch {}
		} catch {}

		if (info.tempDataDir && existsSync(info.tempDataDir)) {
			rmSync(info.tempDataDir, { recursive: true, force: true });
		}

		const fixtureDir = typeof info.workDir === "string" ? info.workDir : FIXTURE_DIR;

		for (const dir of [".astro", ".wrangler"]) {
			const path = join(fixtureDir, dir);
			if (existsSync(path)) rmSync(path, { recursive: true, force: true });
		}

		const emdashDir = join(fixtureDir, ".emdash");
		if (existsSync(emdashDir)) {
			for (const entry of readdirSync(emdashDir)) {
				if (entry === "seed.json") continue;
				const entryPath = join(emdashDir, entry);
				rmSync(entryPath, { recursive: true, force: true });
			}
		}
	} finally {
		unlinkSync(SERVER_INFO_PATH);
	}

	console.log("[pw] Server stopped and temp directory cleaned up.");
}
