import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPathMapper, ensureUpstreamCommit } from "./upstream-sync.mjs";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const configurationPath = "scripts/config/emdash-integration.json";

function git(root, args, encoding = "utf8") {
	const result = spawnSync("git", args, { cwd: root, encoding, maxBuffer: 1 << 30 });
	if (result.status !== 0) {
		throw new Error(String(result.stderr || result.stdout || `git ${args.join(" ")} failed`));
	}
	return result.stdout;
}

export function upstreamFiles(root = defaultRoot) {
	if (!existsSync(resolve(root, configurationPath))) return null;
	const configuration = JSON.parse(readFileSync(resolve(root, configurationPath), "utf8"));
	ensureUpstreamCommit(root, configuration.upstream);
	const mapPath = createPathMapper(configuration.upstreamSync);
	const paths = new Map();
	for (const upstreamPath of git(root, [
		"ls-tree",
		"-r",
		"--name-only",
		configuration.upstream.commit,
	]).split("\n")) {
		const localPath = upstreamPath && mapPath(upstreamPath);
		if (localPath) paths.set(localPath, upstreamPath);
	}
	return {
		paths,
		content(localPath) {
			const upstreamPath = paths.get(localPath);
			return upstreamPath
				? git(root, ["show", `${configuration.upstream.commit}:${upstreamPath}`], "buffer")
				: null;
		},
	};
}
