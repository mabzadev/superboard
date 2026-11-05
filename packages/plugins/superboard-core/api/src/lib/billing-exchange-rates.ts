import { readTextLimited } from "./http-limits";

const ECB_REFERENCE_RATES_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A";
const SECONDARY_RATES_URLS = [
	(day: string) =>
		`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/eur.min.json`,
	(day: string) => `https://${day}.currency-api.pages.dev/v1/currencies/eur.min.json`,
];
export const DISPLAY_CURRENCIES = [
	"USD",
	"EUR",
	"GBP",
	"AUD",
	"CAD",
	"JPY",
	"BRL",
	"KRW",
	"CNY",
	"MXN",
	"SEK",
	"PLN",
] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
export type DisplayCurrencyViewer = { instanceId: number; operatorId: string };

const SOURCE = "ecb";
const SECONDARY_SOURCE = "currency-api";
const SECONDARY_FIRST_DAY = "2024-03-02";
const SECONDARY_DAYS_PER_RUN = 10;
const SECONDARY_MISSING_GRACE_DAYS = 3;
const SECONDARY_FETCH_TIMEOUT_MS = 10_000;
const SECONDARY_MAX_RESPONSE_BYTES = 512 * 1024;
const FIRST_PUBLICATION_DAY = "1999-01-04";
const PUBLICATION_LOOKBACK_DAYS = 7;
const PUBLICATION_HOUR_UTC = 16;
const INITIAL_WINDOW_DAYS = 31;
const FETCH_WINDOW_DAYS = 180;
const RETRY_INTERVAL_MS = 3_600_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const ROWS_PER_INSERT = 24;
const STATEMENTS_PER_BATCH = 50;
const BACKFILL_BATCH_SIZE = 200;
const BACKFILL_BATCHES_PER_RUN = 10;
const MAX_CURRENCY_FILTER = 90;

type Rates = Map<string, Map<string, number>>;
type Rate = { currency: string; day: string; unitsPerEur: number };

export type ExchangeRateState = {
	coveredFrom: string | null;
	latestRateDate: string | null;
	lastAttemptAt: string | null;
	lastSuccessAt: string | null;
	lastError?: string | null;
};

export type UsdConversion = { usdMicros: number | null; rateDate: string | null };
type Resolution = UsdConversion & { missingRateOn?: string };

export type ConversionInput = {
	amountMicros: number | null;
	currency: string | null;
	occurredAt: string;
};

type PendingRow = {
	id: string;
	amount_micros: number | null;
	currency: string | null;
	occurred_at: string;
};

type BackfillTarget = {
	name: "purchases" | "refunds" | "transactions";
	table: string;
	amount: string;
	currency: string;
	day: string;
	usdColumn: string;
	pending: string;
};

const BACKFILL_TARGETS: BackfillTarget[] = [
	{
		name: "purchases",
		table: "billing_catalog_purchases",
		amount: "purchased_price_micros",
		currency: "currency",
		day: "purchased_at",
		usdColumn: "usd_price_micros",
		pending: "usd_rate_date IS NULL",
	},
	{
		name: "refunds",
		table: "billing_catalog_refunds",
		amount: "amount_micros",
		currency:
			"COALESCE(currency, (SELECT purchase.currency FROM billing_catalog_purchases purchase WHERE purchase.id = billing_catalog_refunds.purchase_id))",
		day: "requested_at",
		usdColumn: "usd_amount_micros",
		pending: "usd_rate_date IS NULL",
	},
	{
		name: "transactions",
		table: "billing_transactions",
		amount: "price_micros",
		currency: "currency",
		day: "COALESCE(purchased_at, event_occurred_at, created_at)",
		usdColumn: "usd_price_micros",
		pending: "usd_rate_date IS NULL AND price_micros IS NOT NULL",
	},
];

export function isDisplayCurrency(value: unknown): value is DisplayCurrency {
	return typeof value === "string" && (DISPLAY_CURRENCIES as readonly string[]).includes(value);
}

function addDays(day: string, days: number): string {
	const date = new Date(`${day}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function weekday(day: string): number {
	return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}

function latest(...days: Array<string | null | undefined>): string | null {
	return days.reduce<string | null>(
		(result, day) => (day && (!result || day > result) ? day : result),
		null,
	);
}

function finalRateDay(state: ExchangeRateState): string | null {
	const checkedBefore = state.lastSuccessAt ? addDays(state.lastSuccessAt.slice(0, 10), -1) : null;
	const final = latest(state.latestRateDate, checkedBefore);
	if (!final) return null;
	// The ECB never publishes on weekends, so the days after a final Friday are final too.
	if (weekday(final) === 5) return addDays(final, 2);
	if (weekday(final) === 6) return addDays(final, 1);
	return final;
}

function expectedPublicationDay(now: Date): string {
	let day = now.toISOString().slice(0, 10);
	if (now.getUTCHours() < PUBLICATION_HOUR_UTC) day = addDays(day, -1);
	while (weekday(day) === 0 || weekday(day) === 6) day = addDays(day, -1);
	return day;
}

function exchangeRateFetchDue(state: ExchangeRateState, now: Date): boolean {
	if (state.lastAttemptAt && now.getTime() - Date.parse(state.lastAttemptAt) < RETRY_INTERVAL_MS)
		return false;
	if (!state.latestRateDate) return true;
	const expected = expectedPublicationDay(now);
	if (state.latestRateDate >= expected) return false;
	return !(state.lastSuccessAt && state.lastSuccessAt.slice(0, 10) > expected);
}

function convertToUsd(
	input: ConversionInput,
	rates: Rates,
	state: ExchangeRateState,
	checkedDays?: ReadonlySet<string>,
): Resolution {
	const amount = input.amountMicros;
	const currency = input.currency?.trim().toUpperCase() || null;
	const known = amount === 0 ? 0 : currency === "USD" && amount != null ? amount : null;
	const day = input.occurredAt.slice(0, 10);
	const finalDay = finalRateDay(state);
	if (!finalDay || !state.coveredFrom || day > finalDay || day < state.coveredFrom)
		return { usdMicros: known, rateDate: null };
	let rateDate: string | null = null;
	for (let offset = 0; offset <= PUBLICATION_LOOKBACK_DAYS && !rateDate; offset += 1) {
		const candidate = addDays(day, -offset);
		if (rates.get(candidate)?.has("EUR")) rateDate = candidate;
	}
	if (!rateDate) return { usdMicros: known, rateDate: null };
	if (known != null || amount == null || !currency) return { usdMicros: known, rateDate };
	const published = rates.get(rateDate);
	const source = published?.get(currency);
	const usd = published?.get("USD");
	if (source && usd) return { usdMicros: Math.round((amount * usd) / source), rateDate };
	if (checkedDays?.has(rateDate)) return { usdMicros: null, rateDate };
	return { usdMicros: null, rateDate: null, missingRateOn: rateDate };
}

function parseEcbReferenceRates(text: string): Rate[] {
	const lines = text.split(/\r?\n/u).filter((line) => line.trim());
	const header = lines.shift()?.split(",") ?? [];
	const column = (name: string) => header.indexOf(name);
	const [currencyIndex, denominatorIndex, dayIndex, valueIndex] = [
		column("CURRENCY"),
		column("CURRENCY_DENOM"),
		column("TIME_PERIOD"),
		column("OBS_VALUE"),
	];
	if ([currencyIndex, dayIndex, valueIndex].some((index) => index < 0))
		throw new Error("ECB reference rates response has an unexpected format");
	const rates: Rate[] = [];
	for (const line of lines) {
		const cells = line.split(",");
		const currency = cells[currencyIndex] ?? "";
		const day = cells[dayIndex] ?? "";
		const unitsPerEur = Number(cells[valueIndex]);
		if (
			/^[A-Z]{3}$/u.test(currency) &&
			(denominatorIndex < 0 || cells[denominatorIndex] === "EUR") &&
			/^\d{4}-\d{2}-\d{2}$/u.test(day) &&
			Number.isFinite(unitsPerEur) &&
			unitsPerEur > 0
		)
			rates.push({ currency, day, unitsPerEur });
	}
	return rates;
}

async function readExchangeRateState(db: D1Database, source = SOURCE): Promise<ExchangeRateState> {
	const row = await db
		.prepare(
			"SELECT covered_from, latest_rate_date, last_attempt_at, last_success_at, last_error FROM billing_exchange_rate_sync WHERE source = ?",
		)
		.bind(source)
		.first<{
			covered_from: string | null;
			latest_rate_date: string | null;
			last_attempt_at: string | null;
			last_success_at: string | null;
			last_error: string | null;
		}>();
	return {
		coveredFrom: row?.covered_from ?? null,
		latestRateDate: row?.latest_rate_date ?? null,
		lastAttemptAt: row?.last_attempt_at ?? null,
		lastSuccessAt: row?.last_success_at ?? null,
		lastError: row?.last_error ?? null,
	};
}

async function loadRates(
	db: D1Database,
	fromDay: string,
	toDay: string,
	currencies: Iterable<string>,
): Promise<Rates> {
	const wanted = [...new Set(["EUR", "USD", ...currencies])].filter((currency) =>
		/^[A-Z]{3}$/u.test(currency),
	);
	const filtered = wanted.length <= MAX_CURRENCY_FILTER;
	const rows = await db
		.prepare(
			`SELECT currency, rate_date, units_per_eur FROM billing_exchange_rates WHERE rate_date >= ? AND rate_date <= ?${filtered ? ` AND currency IN (${wanted.map(() => "?").join(",")})` : ""}`,
		)
		.bind(fromDay, toDay, ...(filtered ? wanted : []))
		.all<{ currency: string; rate_date: string; units_per_eur: number }>();
	const rates: Rates = new Map();
	for (const row of rows.results) {
		const day = rates.get(row.rate_date) ?? new Map<string, number>();
		day.set(row.currency, Number(row.units_per_eur));
		rates.set(row.rate_date, day);
	}
	return rates;
}

function rateWindow(inputs: ConversionInput[]): [string, string] | null {
	const days = inputs.map((input) => input.occurredAt.slice(0, 10)).sort();
	const first = days[0];
	const last = days.at(-1);
	return first && last ? [addDays(first, -PUBLICATION_LOOKBACK_DAYS), last] : null;
}

export async function usdConversions(
	db: D1Database,
	inputs: ConversionInput[],
): Promise<UsdConversion[]> {
	const window = rateWindow(inputs);
	if (!window) return [];
	const [state, rates] = await Promise.all([
		readExchangeRateState(db),
		loadRates(db, window[0], window[1], currencyCodes(inputs)),
	]);
	return inputs.map((input) => {
		const { usdMicros, rateDate } = convertToUsd(input, rates, state);
		return { usdMicros, rateDate };
	});
}

function currencyCodes(inputs: ConversionInput[]): string[] {
	return inputs.flatMap((input) => (input.currency ? [input.currency.trim().toUpperCase()] : []));
}

async function fetchReferenceRates(
	fetcher: typeof fetch,
	fromDay: string,
	toDay: string,
): Promise<Rate[]> {
	const url = new URL(ECB_REFERENCE_RATES_URL);
	url.searchParams.set("startPeriod", fromDay);
	url.searchParams.set("endPeriod", toDay);
	url.searchParams.set("detail", "dataonly");
	url.searchParams.set("format", "csvdata");
	const response = await fetcher(url.toString(), {
		headers: { Accept: "text/csv" },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (response.status === 404) {
		await response.body?.cancel();
		return [];
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`ECB reference rates request failed with status ${response.status}`);
	}
	const text = await readTextLimited(response, MAX_RESPONSE_BYTES, "ECB response is too large");
	return text.trim() ? parseEcbReferenceRates(text) : [];
}

function rateStatements(db: D1Database, rows: Rate[], source: string): D1PreparedStatement[] {
	const statements: D1PreparedStatement[] = [];
	for (let index = 0; index < rows.length; index += ROWS_PER_INSERT) {
		const chunk = rows.slice(index, index + ROWS_PER_INSERT);
		statements.push(
			db
				.prepare(
					`INSERT INTO billing_exchange_rates (currency, rate_date, units_per_eur, source) VALUES ${chunk.map(() => "(?, ?, ?, ?)").join(", ")} ON CONFLICT(currency, rate_date) DO NOTHING`,
				)
				.bind(...chunk.flatMap((rate) => [rate.currency, rate.day, rate.unitsPerEur, source])),
		);
	}
	return statements;
}

async function storeRates(db: D1Database, rates: Rate[]): Promise<number> {
	const rows = [
		...rates,
		...[...new Set(rates.map((rate) => rate.day))].map((day) => ({
			currency: "EUR",
			day,
			unitsPerEur: 1,
		})),
	];
	const statements = rateStatements(db, rows, SOURCE);
	for (let index = 0; index < statements.length; index += STATEMENTS_PER_BATCH)
		await db.batch(statements.slice(index, index + STATEMENTS_PER_BATCH));
	return rates.length;
}

async function saveState(
	db: D1Database,
	state: ExchangeRateState,
	error: string | null,
	source = SOURCE,
) {
	await db
		.prepare(
			`INSERT INTO billing_exchange_rate_sync (source, covered_from, latest_rate_date, last_attempt_at, last_success_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(source) DO UPDATE SET covered_from = excluded.covered_from,
         latest_rate_date = excluded.latest_rate_date, last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at, last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
		)
		.bind(
			source,
			state.coveredFrom,
			state.latestRateDate,
			state.lastAttemptAt,
			state.lastSuccessAt,
			error ? error.slice(0, 500) : null,
		)
		.run();
}

async function earliestPendingDay(db: D1Database): Promise<string | null> {
	const row = await db
		.prepare(
			`SELECT ${BACKFILL_TARGETS.map(
				(target, index) =>
					`(SELECT MIN(${target.day}) FROM ${target.table} WHERE ${target.pending} AND ${target.day} >= ?) AS day_${index}`,
			).join(", ")}`,
		)
		.bind(...BACKFILL_TARGETS.map(() => FIRST_PUBLICATION_DAY))
		.first<Record<string, string | null>>();
	const days = Object.values(row ?? {}).flatMap((value) =>
		typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value) ? [value.slice(0, 10)] : [],
	);
	return days.sort()[0] ?? null;
}

function pendingInput(row: PendingRow): ConversionInput {
	return {
		amountMicros: row.amount_micros == null ? null : Number(row.amount_micros),
		currency: row.currency,
		occurredAt: row.occurred_at,
	};
}

async function checkedSecondaryDays(
	db: D1Database,
	fromDay: string,
	toDay: string,
): Promise<Set<string>> {
	const rows = await db
		.prepare(
			"SELECT rate_date FROM billing_exchange_rate_days WHERE source = ? AND rate_date >= ? AND rate_date <= ?",
		)
		.bind(SECONDARY_SOURCE, fromDay, toDay)
		.all<{ rate_date: string }>();
	return new Set(rows.results.map((row) => row.rate_date));
}

async function backfillTarget(
	db: D1Database,
	target: BackfillTarget,
	state: ExchangeRateState,
	missing: Map<string, Set<string>>,
): Promise<number> {
	const finalDay = finalRateDay(state);
	if (!finalDay || !state.coveredFrom) return 0;
	const before = addDays(finalDay, 1);
	let cursor: { day: string; id: string } | null = null;
	let converted = 0;
	for (let batch = 0; batch < BACKFILL_BATCHES_PER_RUN; batch += 1) {
		const after: string = cursor ? `AND (${target.day} > ? OR (${target.day} = ? AND id > ?))` : "";
		const rows: D1Result<PendingRow> = await db
			.prepare(
				`SELECT id, ${target.amount} AS amount_micros, ${target.currency} AS currency, ${target.day} AS occurred_at
         FROM ${target.table}
         WHERE ${target.pending} AND ${target.day} >= ? AND ${target.day} < ? ${after}
         ORDER BY ${target.day}, id LIMIT ?`,
			)
			.bind(
				state.coveredFrom,
				before,
				...(cursor ? [cursor.day, cursor.day, cursor.id] : []),
				BACKFILL_BATCH_SIZE,
			)
			.all<PendingRow>();
		const pending: PendingRow[] = rows.results;
		const last: PendingRow | undefined = pending.at(-1);
		if (!last) break;
		cursor = { day: last.occurred_at, id: last.id };
		const inputs = pending.map(pendingInput);
		const window = rateWindow(inputs);
		const [rates, checked] = window
			? await Promise.all([
					loadRates(db, window[0], window[1], currencyCodes(inputs)),
					checkedSecondaryDays(db, window[0], window[1]),
				])
			: [new Map<string, Map<string, number>>(), new Set<string>()];
		const updates = pending.flatMap((row) => {
			const input = pendingInput(row);
			const conversion = convertToUsd(input, rates, state, checked);
			if (conversion.missingRateOn && input.currency) {
				const currencies = missing.get(conversion.missingRateOn) ?? new Set<string>();
				currencies.add(input.currency.trim().toUpperCase());
				missing.set(conversion.missingRateOn, currencies);
			}
			if (!conversion.rateDate) return [];
			return [
				db
					.prepare(
						`UPDATE ${target.table} SET ${target.usdColumn} = ?, usd_rate_date = ? WHERE id = ? AND usd_rate_date IS NULL`,
					)
					.bind(conversion.usdMicros, conversion.rateDate, row.id),
			];
		});
		if (updates.length) await db.batch(updates);
		converted += updates.length;
		if (pending.length < BACKFILL_BATCH_SIZE) break;
	}
	return converted;
}

type SecondaryDay = { status: "loaded"; rates: Map<string, number> } | { status: "missing" };

function parseSecondaryRates(text: string, day: string): Map<string, number> {
	const body: unknown = JSON.parse(text);
	if (!isRecord(body) || body.date !== day || !isRecord(body.eur))
		throw new Error("Currency API response has an unexpected format");
	const rates = new Map<string, number>();
	for (const [code, value] of Object.entries(body.eur))
		if (
			/^[a-z]{3}$/u.test(code) &&
			typeof value === "number" &&
			Number.isFinite(value) &&
			value > 0
		)
			rates.set(code.toUpperCase(), value);
	if (!rates.has("USD")) throw new Error("Currency API response has no US dollar rate");
	return rates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchSecondaryDay(fetcher: typeof fetch, day: string): Promise<SecondaryDay> {
	let missing = 0;
	let failure = "Currency API request failed";
	for (const url of SECONDARY_RATES_URLS) {
		try {
			const response = await fetcher(url(day), {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(SECONDARY_FETCH_TIMEOUT_MS),
			});
			if (response.ok) {
				const text = await readTextLimited(
					response,
					SECONDARY_MAX_RESPONSE_BYTES,
					"Currency API response is too large",
				);
				return { status: "loaded", rates: parseSecondaryRates(text, day) };
			}
			await response.body?.cancel();
			if (response.status === 404) missing += 1;
			else failure = `Currency API request failed with status ${response.status}`;
		} catch (error) {
			failure = error instanceof Error ? error.message : failure;
		}
	}
	if (missing === SECONDARY_RATES_URLS.length) return { status: "missing" };
	throw new Error(failure);
}

function isoCurrencies(): Set<string> {
	try {
		return new Set(Intl.supportedValuesOf("currency"));
	} catch {
		return new Set();
	}
}

function dayStatement(
	db: D1Database,
	day: string,
	status: "loaded" | "unavailable",
	count: number,
) {
	return db
		.prepare(
			`INSERT INTO billing_exchange_rate_days (source, rate_date, status, currencies, checked_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(source, rate_date) DO UPDATE SET status = excluded.status,
         currencies = excluded.currencies, checked_at = excluded.checked_at`,
		)
		.bind(SECONDARY_SOURCE, day, status, count);
}

async function storeSecondaryDay(
	db: D1Database,
	day: string,
	published: Map<string, number>,
	needed: ReadonlySet<string>,
): Promise<number | null> {
	const ecb = await db
		.prepare(
			"SELECT currency, units_per_eur FROM billing_exchange_rates WHERE rate_date = ? AND source = ?",
		)
		.bind(day, SOURCE)
		.all<{ currency: string; units_per_eur: number }>();
	const ecbRates = new Map(ecb.results.map((row) => [row.currency, Number(row.units_per_eur)]));
	const ecbUsd = ecbRates.get("USD");
	const secondaryUsd = published.get("USD");
	if (!ecbUsd || !secondaryUsd) return null;
	const iso = isoCurrencies();
	// Rebasing on the ECB dollar keeps the source's own rate against the US dollar, the
	// currency every amount is converted to first.
	const rows = [...published]
		.filter(([currency]) => !ecbRates.has(currency) && (iso.has(currency) || needed.has(currency)))
		.map(([currency, unitsPerEur]) => ({
			currency,
			day,
			unitsPerEur: (unitsPerEur * ecbUsd) / secondaryUsd,
		}));
	await db.batch([
		...rateStatements(db, rows, SECONDARY_SOURCE),
		dayStatement(db, day, "loaded", rows.length),
	]);
	return rows.length;
}

async function syncSecondaryRates(
	db: D1Database,
	fetcher: typeof fetch,
	missing: Map<string, Set<string>>,
	now: Date,
) {
	const result = { days: 0, rates: 0, error: null as string | null };
	const state = await readExchangeRateState(db, SECONDARY_SOURCE);
	if (
		state.lastError &&
		state.lastAttemptAt &&
		now.getTime() - Date.parse(state.lastAttemptAt) < RETRY_INTERVAL_MS
	)
		return result;
	const graceLimit = addDays(now.toISOString().slice(0, 10), -SECONDARY_MISSING_GRACE_DAYS);
	const days = [...missing.keys()].sort().slice(0, SECONDARY_DAYS_PER_RUN);
	let requested = false;
	for (const day of days) {
		if (day < SECONDARY_FIRST_DAY) {
			await dayStatement(db, day, "unavailable", 0).run();
			result.days += 1;
			continue;
		}
		requested = true;
		try {
			const fetched = await fetchSecondaryDay(fetcher, day);
			if (fetched.status === "missing") {
				if (day > graceLimit) continue;
				await dayStatement(db, day, "unavailable", 0).run();
				result.days += 1;
				continue;
			}
			const stored = await storeSecondaryDay(db, day, fetched.rates, missing.get(day) ?? new Set());
			if (stored === null) continue;
			result.days += 1;
			result.rates += stored;
		} catch (error) {
			result.error = error instanceof Error ? error.message : "Currency API request failed";
			break;
		}
	}
	if (!requested) return result;
	state.lastAttemptAt = now.toISOString();
	if (!result.error) state.lastSuccessAt = now.toISOString();
	await saveState(db, state, result.error, SECONDARY_SOURCE);
	return result;
}

export async function syncBillingExchangeRates(
	env: { DB: D1Database },
	options: { now?: Date; fetcher?: typeof fetch } = {},
) {
	const now = options.now ?? new Date();
	const fetcher = options.fetcher ?? fetch;
	const today = now.toISOString().slice(0, 10);
	const state = await readExchangeRateState(env.DB);
	const summary = {
		rates_fetched: 0,
		history_rates_fetched: 0,
		secondary_days_checked: 0,
		secondary_rates_fetched: 0,
		converted: { purchases: 0, refunds: 0, transactions: 0 },
		error: null as string | null,
		secondary_error: null as string | null,
	};

	if (exchangeRateFetchDue(state, now)) {
		const from = state.latestRateDate
			? addDays(state.latestRateDate, 1)
			: addDays(today, -INITIAL_WINDOW_DAYS);
		const windowEnd = addDays(from, FETCH_WINDOW_DAYS - 1);
		const end = windowEnd < today ? windowEnd : today;
		state.lastAttemptAt = now.toISOString();
		try {
			const rates = from <= end ? await fetchReferenceRates(fetcher, from, end) : [];
			summary.rates_fetched = await storeRates(env.DB, rates);
			state.latestRateDate = latest(state.latestRateDate, ...rates.map((rate) => rate.day));
			state.coveredFrom ??= from;
			state.lastSuccessAt = now.toISOString();
			await saveState(env.DB, state, null);
		} catch (error) {
			summary.error = error instanceof Error ? error.message : "Exchange rate update failed";
			await saveState(env.DB, state, summary.error);
		}
	}

	if (state.coveredFrom) {
		const pendingDay = await earliestPendingDay(env.DB);
		const needed = pendingDay
			? latest(FIRST_PUBLICATION_DAY, addDays(pendingDay, -PUBLICATION_LOOKBACK_DAYS))
			: null;
		if (needed && needed < state.coveredFrom) {
			const floor = addDays(state.coveredFrom, -FETCH_WINDOW_DAYS);
			const from = needed > floor ? needed : floor;
			try {
				const rates = await fetchReferenceRates(fetcher, from, addDays(state.coveredFrom, -1));
				summary.history_rates_fetched = await storeRates(env.DB, rates);
				state.coveredFrom = from;
				await saveState(env.DB, state, null);
			} catch (error) {
				summary.error = error instanceof Error ? error.message : "Exchange rate history failed";
			}
		}
	}

	const missing = new Map<string, Set<string>>();
	for (const target of BACKFILL_TARGETS)
		summary.converted[target.name] = await backfillTarget(env.DB, target, state, missing);
	if (missing.size) {
		const secondary = await syncSecondaryRates(env.DB, fetcher, missing, now);
		summary.secondary_days_checked = secondary.days;
		summary.secondary_rates_fetched = secondary.rates;
		summary.secondary_error = secondary.error;
		if (secondary.days)
			for (const target of BACKFILL_TARGETS)
				summary.converted[target.name] += await backfillTarget(env.DB, target, state, new Map());
	}
	return summary;
}

export function displayCurrencyViewer(
	instanceId: unknown,
	operatorId: unknown,
): DisplayCurrencyViewer | null {
	const instance = Number(instanceId);
	if (
		typeof operatorId !== "string" ||
		!operatorId ||
		!Number.isSafeInteger(instance) ||
		instance <= 0
	)
		return null;
	return { instanceId: instance, operatorId };
}

export async function readDisplayCurrency(
	db: D1Database,
	viewer: DisplayCurrencyViewer | null,
): Promise<DisplayCurrency> {
	if (!viewer) return "USD";
	const row = await db
		.prepare(
			"SELECT display_currency FROM billing_operator_currency_preferences WHERE instance_id = ? AND operator_id = ?",
		)
		.bind(viewer.instanceId, viewer.operatorId)
		.first<{ display_currency: string }>();
	return isDisplayCurrency(row?.display_currency) ? row.display_currency : "USD";
}

export async function saveDisplayCurrency(
	db: D1Database,
	viewer: DisplayCurrencyViewer,
	currency: DisplayCurrency,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO billing_operator_currency_preferences (instance_id, operator_id, display_currency)
       VALUES (?, ?, ?)
       ON CONFLICT(instance_id, operator_id) DO UPDATE SET display_currency = excluded.display_currency,
         updated_at = datetime('now')`,
		)
		.bind(viewer.instanceId, viewer.operatorId, currency)
		.run();
}

export function displayCurrencySource(alias: string): string {
	return `(SELECT COALESCE(?, (SELECT preference.display_currency FROM billing_operator_currency_preferences preference WHERE preference.instance_id = ? AND preference.operator_id = ?), 'USD') AS currency) ${alias}`;
}

export function displayCurrencyBindings(
	viewer: DisplayCurrencyViewer | null,
	requested: DisplayCurrency | null = null,
): [DisplayCurrency | null, number | null, string | null] {
	return [requested, viewer?.instanceId ?? null, viewer?.operatorId ?? null];
}

export function displayAmountJoins(rateDate: string, displayAlias: string, prefix: string): string {
	return `LEFT JOIN billing_exchange_rates ${prefix}_usd ON ${prefix}_usd.currency = 'USD' AND ${prefix}_usd.rate_date = ${rateDate}
    LEFT JOIN billing_exchange_rates ${prefix}_display ON ${prefix}_display.currency = ${displayAlias}.currency AND ${prefix}_display.rate_date = ${rateDate}`;
}

export function displayAmountSql(
	original: { amount: string; currency: string },
	usdAmount: string,
	displayAlias: string,
	prefix: string,
): string {
	return `(CASE WHEN upper(${original.currency}) = ${displayAlias}.currency THEN ${original.amount}
    WHEN ${displayAlias}.currency = 'USD' THEN ${usdAmount}
    WHEN ${usdAmount} = 0 THEN 0
    WHEN ${usdAmount} IS NULL OR ${prefix}_usd.units_per_eur IS NULL OR ${prefix}_display.units_per_eur IS NULL THEN NULL
    ELSE CAST(ROUND(${usdAmount} * ${prefix}_display.units_per_eur / ${prefix}_usd.units_per_eur) AS INTEGER) END)`;
}
