import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";

import { encodeBase64url } from "../../utils/base64.js";

function generateAuthSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return encodeBase64url(bytes);
}

const secretCommand = defineCommand({
	meta: {
		name: "secret",
		description: "[DEPRECATED] Generate a value for legacy EMDASH_AUTH_SECRET",
	},
	run() {
		const secret = generateAuthSecret();

		consola.log("");
		consola.log(pc.bold("Generated auth secret:"));
		consola.log("");
		consola.log(`  ${pc.cyan("EMDASH_AUTH_SECRET")}=${pc.green(secret)}`);
		consola.log("");
		consola.log(pc.dim("Add this to your environment variables."));
		consola.log("");
		process.stderr.write(
			`${pc.yellow("Note:")} ${pc.bold("emdash auth secret")} is deprecated and will be removed in a future minor. ` +
				`${pc.cyan("EMDASH_AUTH_SECRET")} itself is now optional — it's only used as a legacy fallback for the commenter-IP hash salt. ` +
				`For encrypting plugin secrets at rest, use ${pc.bold("emdash secrets generate")} (a different secret: ${pc.cyan("EMDASH_ENCRYPTION_KEY")}).\n`,
		);
	},
});

export const authCommand = defineCommand({
	meta: {
		name: "auth",
		description: "[DEPRECATED] Authentication utilities (use `emdash secrets` for new flows)",
	},
	subCommands: {
		secret: secretCommand,
	},
});
