import type { Kysely, Transaction } from "kysely";

let transactionsSupported: boolean | null = null;
const TRANSACTIONS_NOT_SUPPORTED_RE = /transactions are not supported/i;

export async function withTransaction<DB, T>(
	db: Kysely<DB>,
	fn: (trx: Kysely<DB> | Transaction<DB>) => Promise<T>,
): Promise<T> {
	if (db.isTransaction) return fn(db);
	if (transactionsSupported === true) {
		return db.transaction().execute(fn);
	}

	if (transactionsSupported === false) {
		return fn(db);
	}

	try {
		const result = await db.transaction().execute(fn);
		transactionsSupported = true;
		return result;
	} catch (error) {
		if (error instanceof Error && TRANSACTIONS_NOT_SUPPORTED_RE.test(error.message)) {
			transactionsSupported = false;
			return fn(db);
		}
		throw error;
	}
}
