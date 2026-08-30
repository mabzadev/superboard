import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const dashboard = join(root, "apps/dashboard");
const TYPESCRIPT_EXTENSION_PATTERN = /\.tsx$/u;
const PAGE_SEGMENT_PATTERN = /\/page$/u;
const CATCH_ALL_SEGMENT_PATTERN = /\[\.\.\.[^\]]+\]/gu;
const DYNAMIC_SEGMENT_PATTERN = /\[[^\]]+\]/gu;

test("every Dashboard page compiles and serves an executable HTTP surface", async () => {
	const result = spawnSync("pnpm", ["run", "build:support"], {
		cwd: dashboard,
		encoding: "utf8",
		env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const manifestPath = join(dashboard, ".next/server/app-paths-manifest.json");
	assert.equal(existsSync(manifestPath), true);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const pages = walk(join(dashboard, "src/app"));
	const pageKeys = [];
	for (const page of pages) {
		const key = `/${relative(join(dashboard, "src/app"), page)
			.replaceAll(sep, "/")
			.replace(TYPESCRIPT_EXTENSION_PATTERN, "")}`;
		assert.ok(manifest[key], `compiled route missing: ${key}`);
		pageKeys.push(key);
	}

	const port = 39_154;
	const server = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
		cwd: dashboard,
		stdio: "ignore",
		detached: true,
		env: {
			...process.env,
			NEXT_TELEMETRY_DISABLED: "1",
			NEXT_PUBLIC_API_URL: "https://api.example.test",
			NEXT_PUBLIC_AUTH_URL: "https://auth.example.test",
			NEXT_PUBLIC_CLIENT_ID: "parity-test",
			NEXT_PUBLIC_ENV: "test",
		},
	});
	try {
		await waitForServer(port);
		for (const key of pageKeys) {
			const route = key
				.replace("/(protected)", "")
				.replace(PAGE_SEGMENT_PATTERN, "")
				.replaceAll(CATCH_ALL_SEGMENT_PATTERN, "parity-path")
				.replaceAll(DYNAMIC_SEGMENT_PATTERN, "parity-id") || "/";
			const response = await fetch(`http://127.0.0.1:${port}${route}`, {
				redirect: "manual",
			});
			assert.ok(response.status >= 200 && response.status < 400, `${route} returned ${response.status}`);
		}
	} finally {
		if (server.pid) process.kill(-server.pid, "SIGTERM");
	}
});

async function waitForServer(port) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
			if (response.status < 500) return;
		} catch {
			// The local build is still starting.
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error("Dashboard parity server failed to start");
}

function walk(directory) {
	const pages = [];
	for (const name of readdirSync(directory).toSorted()) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) pages.push(...walk(path));
		else if (name === "page.tsx") pages.push(path);
	}
	return pages;
}
