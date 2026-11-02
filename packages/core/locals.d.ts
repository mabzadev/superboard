import type { User } from "@emdash-cms/auth";

import type { EmDashHandlers } from "./dist/astro/types.d.mts";

declare global {
	namespace App {
		interface Locals {
			emdash: EmDashHandlers;

			user?: User;

			__playgroundDb?: unknown;
		}
	}
}

export {};
