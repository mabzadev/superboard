#!/usr/bin/env node

import { defineCommand, runMain } from "citty";

import { buildCommand } from "./build/command.js";
import { bundleCommand } from "./bundle/command.js";
import { infoCommand } from "./commands/info.js";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { publishCommand } from "./commands/publish.js";
import { searchCommand } from "./commands/search.js";
import { switchCommand } from "./commands/switch.js";
import { updatePackageCommand } from "./commands/update-package.js";
import { validateCommand } from "./commands/validate.js";
import { whoamiCommand } from "./commands/whoami.js";
import { devCommand } from "./dev/command.js";

const main = defineCommand({
	meta: {
		name: "emdash-plugin",
		description: "CLI for the experimental EmDash plugin registry",
	},
	subCommands: {
		login: loginCommand,
		logout: logoutCommand,
		whoami: whoamiCommand,
		switch: switchCommand,
		search: searchCommand,
		info: infoCommand,
		init: initCommand,
		build: buildCommand,
		dev: devCommand,
		bundle: bundleCommand,
		publish: publishCommand,
		"update-package": updatePackageCommand,
		validate: validateCommand,
	},
});

void runMain(main).then(() => process.exit(0));
