import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

async function filesWithin(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`CONSOLE_ARTIFACT_SYMLINK:${path}`);
		if (entry.isDirectory()) files.push(...(await filesWithin(path)));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

export async function captureConsoleArtifact(configPath) {
	const path = resolve(configPath);
	const config = JSON.parse(await readFile(path, "utf8"));
	const roots = [dirname(resolve(dirname(path), config.main))];
	if (config.assets?.directory) roots.push(resolve(dirname(path), config.assets.directory));
	const paths = [...new Set([path, ...(await Promise.all(roots.map(filesWithin))).flat()])].sort();
	const files = await Promise.all(
		paths.map(async (file) => ({
			path: file,
			sha256: createHash("sha256")
				.update(await readFile(file))
				.digest("hex"),
		})),
	);
	return { configPath: path, files };
}

export async function verifyConsoleArtifact(artifact) {
	const current = await captureConsoleArtifact(artifact.configPath);
	if (JSON.stringify(current.files) !== JSON.stringify(artifact.files)) {
		throw new Error("CONSOLE_ARTIFACT_CHANGED_AFTER_VALIDATION");
	}
}
