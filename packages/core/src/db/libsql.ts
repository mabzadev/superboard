import { LibsqlDialect } from "@libsql/kysely-libsql";
import type { Dialect } from "kysely";

import type { LibsqlConfig } from "./adapters.js";

export function createDialect(config: LibsqlConfig): Dialect {
	return new LibsqlDialect({
		url: config.url,
		authToken: config.authToken,
	});
}
