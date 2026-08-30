import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/entries/*.ts"],
	format: ["esm"],
	outExtensions: () => ({ js: ".js" }),
	dts: true,
	clean: true,
	inlineOnly: false,
	platform: "neutral",
	target: "es2024",
});
