#!/usr/bin/env node
process.stderr.write(
	"The Dashboard OAuth deployment tool is retired. Operator authentication is managed by the EmDash Site.\n",
);
process.exitCode = 2;
