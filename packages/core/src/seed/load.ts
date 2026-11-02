import type { SeedFile } from "./types.js";

interface SeedModule {
	seed: SeedFile;
	userSeed: SeedFile | null;
}

async function getSeedModule(): Promise<SeedModule> {
	// @ts-ignore - virtual module, only available within Vite runtime
	return import("virtual:emdash/seed") as Promise<SeedModule>;
}

export async function loadSeed(): Promise<SeedFile> {
	const { seed } = await getSeedModule();
	return seed;
}

export async function loadUserSeed(): Promise<SeedFile | null> {
	const { userSeed } = await getSeedModule();
	return userSeed ?? null;
}
