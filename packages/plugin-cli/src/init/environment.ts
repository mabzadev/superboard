import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PACKAGE_JSON_MAX_BYTES = 64 * 1024;

const GIT_TIMEOUT_MS = 2_000;

export interface EnvironmentDefaults {
	authorName: string | undefined;
	authorEmail: string | undefined;
	license: string | undefined;
	description: string | undefined;
	repo: string | undefined;
}

export async function probeEnvironment(targetDir: string): Promise<EnvironmentDefaults> {
	const [authorName, authorEmail, repoFromGit, fromPackageJson] = await Promise.all([
		gitConfig("user.name", targetDir),
		gitConfig("user.email", targetDir),
		gitRemoteUrl(targetDir),
		readPackageJson(targetDir),
	]);

	return {
		authorName,
		authorEmail,
		repo: fromPackageJson.repo ?? repoFromGit,
		license: fromPackageJson.license,
		description: fromPackageJson.description,
	};
}

async function gitConfig(key: string, cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["config", "--get", key], {
			cwd,
			env: gitProbeEnvironment(),
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: 4096,
		});
		const value = stdout.trim();
		return value.length === 0 ? undefined : value;
	} catch {
		return undefined;
	}
}

const GIT_SSH_RE = /^git@([^:]+):(.+?)(?:\.git)?$/;
const HTTPS_TRAILING_GIT_RE = /\.git$/;
const GIT_URL_PREFIX_RE = /^git\+/;

async function gitRemoteUrl(cwd: string): Promise<string | undefined> {
	let raw: string;
	try {
		const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
			cwd,
			env: gitProbeEnvironment(),
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: 1024,
		});
		raw = stdout.trim();
	} catch {
		return undefined;
	}
	if (raw.length === 0) return undefined;
	return normalizeRepoUrl(raw);
}

function gitProbeEnvironment(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const name of [
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_COMMON_DIR",
		"GIT_DIR",
		"GIT_INDEX_FILE",
		"GIT_OBJECT_DIRECTORY",
		"GIT_PREFIX",
		"GIT_WORK_TREE",
	]) {
		delete env[name];
	}
	return env;
}

function normalizeRepoUrl(raw: string): string | undefined {
	const sshMatch = GIT_SSH_RE.exec(raw);
	if (sshMatch) {
		const [, host, path] = sshMatch;
		return `https://${host}/${path}`;
	}
	if (raw.startsWith("https://")) {
		return raw.replace(HTTPS_TRAILING_GIT_RE, "");
	}
	return undefined;
}

interface PackageJsonDefaults {
	license: string | undefined;
	description: string | undefined;
	repo: string | undefined;
}

const EMPTY_PACKAGE_JSON: PackageJsonDefaults = {
	license: undefined,
	description: undefined,
	repo: undefined,
};

async function readPackageJson(targetDir: string): Promise<PackageJsonDefaults> {
	const path = join(targetDir, "package.json");
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return EMPTY_PACKAGE_JSON;
	}
	if (raw.length > PACKAGE_JSON_MAX_BYTES) {
		return EMPTY_PACKAGE_JSON;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return EMPTY_PACKAGE_JSON;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return EMPTY_PACKAGE_JSON;
	}
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed by runtime check above
	const pkg = parsed as Record<string, unknown>;

	const license = typeof pkg.license === "string" ? pkg.license.trim() : undefined;
	const description = typeof pkg.description === "string" ? pkg.description.trim() : undefined;
	const repo = repoFromPackageJsonRepository(pkg.repository);

	return {
		license: license && license.length > 0 ? license : undefined,
		description: description && description.length > 0 ? description : undefined,
		repo,
	};
}

function repoFromPackageJsonRepository(value: unknown): string | undefined {
	let raw: string | undefined;
	if (typeof value === "string") {
		raw = value;
	} else if (value && typeof value === "object" && !Array.isArray(value)) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed by runtime check above
		const url = (value as Record<string, unknown>).url;
		if (typeof url === "string") raw = url;
	}
	if (raw === undefined || raw.length === 0) return undefined;
	const stripped = raw.replace(GIT_URL_PREFIX_RE, "");
	return normalizeRepoUrl(stripped);
}
