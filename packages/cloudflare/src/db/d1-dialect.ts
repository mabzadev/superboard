import type { CompoundSelectLimitedAdapter } from "emdash";
import type { DatabaseIntrospector, Kysely } from "kysely";
import { SqliteAdapter } from "kysely";
import { D1Dialect } from "kysely-d1";

import { D1Introspector } from "./d1-introspector.js";

export const D1_COMPOUND_SELECT_LIMIT = 5;

export class D1Adapter extends SqliteAdapter implements CompoundSelectLimitedAdapter {
	readonly compoundSelectLimit = D1_COMPOUND_SELECT_LIMIT;
}

class RawBindingD1Adapter extends D1Adapter {
	override get supportsMultipleConnections(): boolean {
		return true;
	}
}

export class EmDashD1Dialect extends D1Dialect {
	override createAdapter(): SqliteAdapter {
		return new D1Adapter();
	}

	override createIntrospector(db: Kysely<any>): DatabaseIntrospector {
		return new D1Introspector(db);
	}
}

export class RawBindingD1Dialect extends EmDashD1Dialect {
	override createAdapter(): SqliteAdapter {
		return new RawBindingD1Adapter();
	}
}
