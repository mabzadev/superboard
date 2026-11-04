import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../../../packages/supbrd-front-ui/src/shared/lib/config.js", () => ({
	config: {
		apiUrl: "https://api.example.test",
		clientId: "test-client",
		environment: "test",
		shortlinkUrl: "https://in.example.test",
		sdkUrl: "https://sdk.example.test",
	},
}));

import { sdkInstallCode } from "../../../../../../../../packages/plugins/superboard-core/src/front/settings/components/app/SdkSetupWizard.js";

describe("SDK setup distribution contract", () => {
	it("uses the catalogue's published immutable iOS installation", () => {
		expect(sdkInstallCode("ios")).toEqual([
			{
				language: "swift",
				filename: "Package.swift",
				code: '.package(url: "https://github.com/mabzadev/superboard.git", exact: "1.0.3")',
			},
		]);
	});

	it("guides a local build while the web SDK has no published installation", () => {
		const blocks = sdkInstallCode("web");

		expect(blocks.map(({ filename }) => filename)).toEqual(["Terminal"]);
		expect(blocks[0]?.code).toContain("source not published yet");
		expect(blocks[0]?.code).toContain("pnpm --dir sdks/web build");
		expect(blocks[0]?.code).not.toContain("npm install");
	});

	it("configures Maven credentials before the Android dependency", () => {
		const blocks = sdkInstallCode("android");

		expect(blocks.map(({ filename }) => filename)).toEqual([
			"settings.gradle.kts",
			"build.gradle.kts",
			"Terminal",
		]);
		expect(blocks[0]?.code).toContain(
			'providers.environmentVariable("SUPERBOARD_GITHUB_PACKAGES_USER")',
		);
		expect(blocks[0]?.code).toContain(
			'providers.environmentVariable("SUPERBOARD_GITHUB_PACKAGES_TOKEN")',
		);
		expect(blocks[0]?.code).toContain(
			'url = uri("https://maven.pkg.github.com/mabzadev/superboard-platform")',
		);
		expect(blocks[1]?.code).toBe('implementation("io.superboard:superboard-android-sdk:1.0.3")');
		expect(blocks[2]?.code).toBe(
			`test -n "\${SUPERBOARD_GITHUB_PACKAGES_USER:-}" \\\n  && test -n "\${SUPERBOARD_GITHUB_PACKAGES_TOKEN:-}" \\\n  && ./gradlew assemble`,
		);
	});

	it("never embeds a package token value", () => {
		const source = [...sdkInstallCode("web"), ...sdkInstallCode("android")]
			.map(({ code }) => code)
			.join("\n");

		expect(source).not.toMatch(/\b(?:ghp_|github_pat_)[A-Za-z0-9_]+\b/u);
	});
});
