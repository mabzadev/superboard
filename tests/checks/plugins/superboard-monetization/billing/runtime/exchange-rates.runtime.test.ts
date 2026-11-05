import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import {
	dispatchBillingJob,
	isBillingQueueJob,
} from "../../../../../../packages/plugins/superboard-core/api/src/lib/billing-dispatch.js";
import { syncBillingExchangeRates } from "../../../../../../packages/plugins/superboard-core/api/src/lib/billing-exchange-rates.js";
import worker from "../../../../../../packages/plugins/superboard-monetization/billing/src/index.js";
import { billingTestEnv as testEnv, createExecutionContext } from "./apply-migrations.js";

const projectId = 731;
const projectRef = "73-test";
const migrationName = "0073_billing_exchange_rates.sql";
const holidays = new Set(["2026-12-25"]);
const requestedWindows: Array<[string, string]> = [];

function usdRate(day: string) {
	return 1 + Number(day.slice(8, 10)) / 100;
}

function ecbCsv(from: string, to: string) {
	const lines = ["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE"];
	for (let day = from; day <= to; day = nextDay(day)) {
		const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
		if (weekday === 0 || weekday === 6 || holidays.has(day)) continue;
		for (const [currency, rate] of [
			["CHF", 0.95],
			["JPY", 160],
			["USD", usdRate(day)],
		] as const)
			lines.push(`EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${day},${rate}`);
	}
	return lines.length > 1 ? `${lines.join("\n")}\n` : "";
}

function nextDay(day: string) {
	const date = new Date(`${day}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
}

const secondaryUsd = 1.07;
const secondarySar = 4.0125;

const ecb = vi.fn(async (input: RequestInfo | URL) => {
	const url = new URL(input instanceof Request ? input.url : input);
	const secondaryDay =
		/^\/npm\/@fawazahmed0\/currency-api@(\d{4}-\d{2}-\d{2})\/v1\/currencies\/eur\.min\.json$/u.exec(
			url.pathname,
		)?.[1];
	if (url.hostname === "cdn.jsdelivr.net" && secondaryDay)
		return Response.json({
			date: secondaryDay,
			eur: { usd: secondaryUsd, sar: secondarySar, eur: 1 },
		});
	expect(`${url.origin}${url.pathname}`).toBe(
		"https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A",
	);
	const from = url.searchParams.get("startPeriod")!;
	const to = url.searchParams.get("endPeriod")!;
	requestedWindows.push([from, to]);
	return new Response(ecbCsv(from, to), { headers: { "Content-Type": "text/csv" } });
});

function sync(now: string, fetcher: typeof fetch = ecb) {
	return syncBillingExchangeRates(testEnv, { now: new Date(now), fetcher });
}

async function signedRequest(
	method: string,
	path: string,
	body?: unknown,
	role = "owner",
	operatorId = "currency-operator",
) {
	const headers = await createProjectContextHeaders(
		{
			module: "billing",
			method,
			pathname: new URL(path, "https://billing.internal").pathname,
			projectId,
			projectRef,
			instanceId: 73,
			environment: "test",
			actorId: 0,
			operatorId,
			role,
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		"billing-runtime-internal-token",
	);
	headers.set("Content-Type", "application/json");
	if (method !== "GET") headers.set("Idempotency-Key", crypto.randomUUID());
	return worker.fetch!(
		new Request(`https://billing.internal${path}`, {
			method,
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}) as Request<unknown, IncomingRequestCfProperties>,
		{ ...testEnv, CREDENTIAL_KEY_SCOPE: "billing" },
		createExecutionContext(),
	);
}

const ledger = (method: string, resource: string, body?: unknown) =>
	signedRequest(method, `/internal/v1/catalog-ledger${resource}`, body);

async function recordPurchase(
	transaction: string,
	purchasedAt: string,
	micros: number,
	currency: string | null,
) {
	const response = await ledger("POST", "/purchases", {
		financial_customer_id: `customer-${transaction}`,
		product_id: "currency-pro",
		product_snapshot: {
			identifier: "pro",
			display_name: "Pro",
			product_type: "non_consumable",
			status: "active",
		},
		store: "apple",
		environment: "sandbox",
		external_transaction_id: transaction,
		purchased_at: purchasedAt,
		purchased_price_micros: micros,
		currency,
	});
	expect(response.status).toBe(201);
	return (
		await response.json<{
			data: { id: string; usd_price_micros: number | null; usd_rate_date: string | null };
		}>()
	).data;
}

async function purchaseRow(id: string) {
	return testEnv.DB.prepare(
		"SELECT usd_price_micros, usd_rate_date FROM billing_catalog_purchases WHERE id = ?",
	)
		.bind(id)
		.first<{ usd_price_micros: number | null; usd_rate_date: string | null }>();
}

async function columns(table: string) {
	const rows = await testEnv.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
	return rows.results.map((row) => row.name);
}

beforeAll(async () => {
	await testEnv.DB.batch([
		testEnv.DB.prepare(
			"INSERT INTO instances(id,api_key,uri_scheme) VALUES(73,'currency-test','currency-test')",
		),
		testEnv.DB.prepare(
			"INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(731,73,1,'Currencies','currency-test')",
		),
	]);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("exchange rate migration", () => {
	test("applies to existing purchases after an interrupted attempt and keeps their original amounts", async () => {
		const migration = testEnv.TEST_MIGRATIONS.find((item) => item.name === migrationName);
		expect(migration).toBeDefined();
		await testEnv.DB.batch(
			[
				"DROP INDEX idx_billing_catalog_purchases_usd_pending",
				"DROP INDEX idx_billing_catalog_refunds_usd_pending",
				"DROP INDEX idx_billing_transactions_usd_pending",
				"ALTER TABLE billing_catalog_purchases DROP COLUMN usd_price_micros",
				"ALTER TABLE billing_catalog_purchases DROP COLUMN usd_rate_date",
				"ALTER TABLE billing_catalog_refunds DROP COLUMN usd_amount_micros",
				"ALTER TABLE billing_catalog_refunds DROP COLUMN usd_rate_date",
				"ALTER TABLE billing_transactions DROP COLUMN usd_price_micros",
				"ALTER TABLE billing_transactions DROP COLUMN usd_rate_date",
				"DROP TABLE billing_exchange_rates",
				"DROP TABLE billing_exchange_rate_sync",
			].map((query) => testEnv.DB.prepare(query)),
		);
		await testEnv.DB.batch([
			testEnv.DB.prepare(
				"INSERT INTO billing_catalog_financial_customers(id,project_id,external_customer_id) VALUES('legacy-customer','731','legacy-user')",
			),
			testEnv.DB.prepare(
				"INSERT INTO billing_catalog_purchases(id,project_id,financial_customer_id,product_id,status,purchased_at,purchased_price_micros,currency) VALUES('legacy-eur','731','legacy-customer','legacy-product','active','2026-10-03T12:00:00.000Z',9990000,'EUR')",
			),
			testEnv.DB.prepare(
				"INSERT INTO billing_catalog_refunds(id,project_id,purchase_id,status,amount_micros,currency,requested_at) VALUES('legacy-refund','731','legacy-eur','completed',9990000,NULL,'2026-10-05T09:00:00.000Z')",
			),
		]);
		const before = await testEnv.DB.prepare(
			"SELECT id, purchased_price_micros, currency, purchased_at FROM billing_catalog_purchases WHERE project_id = '731'",
		).all();

		await expect(
			testEnv.DB.batch([
				...migration!.queries.map((query) => testEnv.DB.prepare(query)),
				testEnv.DB.prepare("INSERT INTO billing_missing_table VALUES (1)"),
			]),
		).rejects.toThrow();
		expect(await columns("billing_catalog_purchases")).not.toContain("usd_price_micros");

		await testEnv.DB.batch(migration!.queries.map((query) => testEnv.DB.prepare(query)));

		expect(await columns("billing_catalog_purchases")).toEqual(
			expect.arrayContaining(["usd_price_micros", "usd_rate_date"]),
		);
		expect(await columns("billing_catalog_refunds")).toEqual(
			expect.arrayContaining(["usd_amount_micros", "usd_rate_date"]),
		);
		expect(await columns("billing_transactions")).toEqual(
			expect.arrayContaining(["usd_price_micros", "usd_rate_date"]),
		);
		expect(
			await testEnv.DB.prepare(
				"SELECT id, purchased_price_micros, currency, purchased_at FROM billing_catalog_purchases WHERE project_id = '731'",
			).all(),
		).toMatchObject({ results: before.results });
		expect(await purchaseRow("legacy-eur")).toEqual({
			usd_price_micros: null,
			usd_rate_date: null,
		});
	});
});

describe("exchange rate job", () => {
	test("stores the ECB rates and converts existing purchases at the rate of their day", async () => {
		await testEnv.DB.batch([
			testEnv.DB.prepare(
				"INSERT INTO billing_catalog_purchases(id,project_id,financial_customer_id,product_id,status,purchased_at,purchased_price_micros,currency) VALUES('legacy-usd','731','legacy-customer','legacy-product','active','2026-10-05T12:00:00.000Z',4990000,'USD'),('legacy-jpy','731','legacy-customer','legacy-product','active','2026-10-06T08:00:00.000Z',1600000000,'JPY'),('legacy-sar','731','legacy-customer','legacy-product','active','2026-10-06T08:00:00.000Z',5000000,'SAR'),('legacy-later','731','legacy-customer','legacy-product','active','2026-10-07T08:00:00.000Z',5000000,'EUR')",
			),
			testEnv.DB.prepare(
				"INSERT INTO billing_customers(id,project_id,primary_app_user_id) VALUES('currency-customer','731','currency-user')",
			),
			testEnv.DB.prepare(
				"INSERT INTO billing_transactions(id,project_id,customer_id,store,environment,store_transaction_id,event_type,status,price_micros,currency,purchased_at,raw_payload) VALUES('tx-chf','731','currency-customer','apple','sandbox','store-chf','PURCHASED','active',9500000,'chf','2026-10-02T10:00:00.000Z','{}'),('tx-chf-renew','731','currency-customer','apple','sandbox','store-chf','DID_RENEW','active',9500000,'chf','2026-10-02T10:00:00.000Z','{}'),('tx-free','731','currency-customer','apple','sandbox','store-trial','PURCHASED','trialing',0,NULL,'2026-10-05T10:00:00.000Z','{}'),('tx-pending','731','currency-customer','apple','sandbox','store-pending','PURCHASED','pending',3000000,'USD','2026-10-05T10:00:00.000Z','{}')",
			),
		]);

		const summary = await sync("2026-10-06T18:00:00.000Z");

		expect(summary.error).toBeNull();
		expect(requestedWindows.at(-1)).toEqual(["2026-09-05", "2026-10-06"]);
		expect(
			await testEnv.DB.prepare(
				"SELECT currency, units_per_eur FROM billing_exchange_rates WHERE rate_date = '2026-10-02' ORDER BY currency",
			).all(),
		).toMatchObject({
			results: [
				{ currency: "CHF", units_per_eur: 0.95 },
				{ currency: "EUR", units_per_eur: 1 },
				{ currency: "JPY", units_per_eur: 160 },
				{ currency: "USD", units_per_eur: 1.02 },
			],
		});
		expect(await purchaseRow("legacy-eur")).toEqual({
			usd_price_micros: Math.round(9_990_000 * 1.02),
			usd_rate_date: "2026-10-02",
		});
		expect(await purchaseRow("legacy-usd")).toEqual({
			usd_price_micros: 4_990_000,
			usd_rate_date: "2026-10-05",
		});
		expect(await purchaseRow("legacy-jpy")).toEqual({
			usd_price_micros: Math.round((1_600_000_000 * 1.06) / 160),
			usd_rate_date: "2026-10-06",
		});
		expect(await purchaseRow("legacy-sar")).toEqual({
			usd_price_micros: Math.round((5_000_000 * secondaryUsd) / secondarySar),
			usd_rate_date: "2026-10-06",
		});
		expect(await purchaseRow("legacy-later")).toEqual({
			usd_price_micros: null,
			usd_rate_date: null,
		});
		expect(
			await testEnv.DB.prepare(
				"SELECT usd_amount_micros, usd_rate_date FROM billing_catalog_refunds WHERE id = 'legacy-refund'",
			).first(),
		).toEqual({ usd_amount_micros: Math.round(9_990_000 * 1.05), usd_rate_date: "2026-10-05" });
		expect(
			await testEnv.DB.prepare(
				"SELECT id, usd_price_micros, usd_rate_date FROM billing_transactions WHERE project_id = '731' ORDER BY id",
			).all(),
		).toMatchObject({
			results: [
				{
					id: "tx-chf",
					usd_price_micros: Math.round((9_500_000 * 1.02) / 0.95),
					usd_rate_date: "2026-10-02",
				},
				{ id: "tx-chf-renew", usd_rate_date: "2026-10-02" },
				{ id: "tx-free", usd_price_micros: 0, usd_rate_date: "2026-10-05" },
				{ id: "tx-pending", usd_price_micros: 3_000_000, usd_rate_date: "2026-10-05" },
			],
		});
	});

	test("waits for a weekday rate, then converts with it once published", async () => {
		const pending = await recordPurchase(
			"eur-wednesday",
			"2026-10-07T09:00:00.000Z",
			10_000_000,
			"EUR",
		);
		expect(pending).toMatchObject({ usd_price_micros: null, usd_rate_date: null });
		const dollars = await recordPurchase(
			"usd-wednesday",
			"2026-10-07T09:00:00.000Z",
			2_000_000,
			"USD",
		);
		expect(dollars).toMatchObject({ usd_price_micros: 2_000_000, usd_rate_date: null });

		const early = await sync("2026-10-07T12:00:00.000Z");
		expect(early.rates_fetched).toBe(0);
		expect(await purchaseRow(pending.id)).toEqual({ usd_price_micros: null, usd_rate_date: null });

		await sync("2026-10-07T18:00:00.000Z");
		expect(requestedWindows.at(-1)).toEqual(["2026-10-07", "2026-10-07"]);
		expect(await purchaseRow(pending.id)).toEqual({
			usd_price_micros: Math.round(10_000_000 * 1.07),
			usd_rate_date: "2026-10-07",
		});
		expect(await purchaseRow(dollars.id)).toEqual({
			usd_price_micros: 2_000_000,
			usd_rate_date: "2026-10-07",
		});
		expect(await purchaseRow("legacy-later")).toEqual({
			usd_price_micros: Math.round(5_000_000 * 1.07),
			usd_rate_date: "2026-10-07",
		});
	});

	test("converts a new purchase at insert when the rate of its day is known", async () => {
		const saturday = await recordPurchase(
			"chf-saturday",
			"2026-10-03T21:00:00.000Z",
			9_500_000,
			"CHF",
		);
		expect(saturday).toMatchObject({
			usd_price_micros: Math.round((9_500_000 * 1.02) / 0.95),
			usd_rate_date: "2026-10-02",
		});
		const refund = await ledger("POST", `/purchases/${saturday.id}/refunds`, {
			status: "completed",
			amount_micros: 9_500_000,
			requested_at: "2026-10-06T10:00:00.000Z",
			completed_at: "2026-10-06T10:00:00.000Z",
		});
		expect(refund.status).toBe(201);
		expect((await refund.json<{ data: Record<string, unknown> }>()).data).toMatchObject({
			currency: "CHF",
			usd_amount_micros: Math.round((9_500_000 * 1.06) / 0.95),
			usd_rate_date: "2026-10-06",
		});
	});

	test("uses the last rate published before a holiday once the holiday is known to have no quotation", async () => {
		await sync("2026-12-24T18:00:00.000Z");
		const christmas = await recordPurchase(
			"eur-christmas",
			"2026-12-25T10:00:00.000Z",
			10_000_000,
			"EUR",
		);
		expect(christmas.usd_rate_date).toBeNull();

		await sync("2026-12-25T18:00:00.000Z");
		expect(await purchaseRow(christmas.id)).toEqual({
			usd_price_micros: null,
			usd_rate_date: null,
		});

		await sync("2026-12-26T09:00:00.000Z");
		expect(await purchaseRow(christmas.id)).toEqual({
			usd_price_micros: Math.round(10_000_000 * 1.24),
			usd_rate_date: "2026-12-24",
		});
	});

	test("loads older rates in bounded windows for purchases older than the stored history", async () => {
		await testEnv.DB.prepare(
			"INSERT INTO billing_catalog_purchases(id,project_id,financial_customer_id,product_id,status,purchased_at,purchased_price_micros,currency) VALUES('legacy-2025','731','legacy-customer','legacy-product','active','2025-03-12T12:00:00.000Z',9990000,'EUR')",
		).run();
		requestedWindows.length = 0;
		for (let run = 0; run < 4; run += 1) await sync("2026-12-26T10:00:00.000Z");

		expect(requestedWindows).toEqual([
			["2026-03-09", "2026-09-04"],
			["2025-09-10", "2026-03-08"],
			["2025-03-14", "2025-09-09"],
			["2025-03-05", "2025-03-13"],
		]);
		expect(await purchaseRow("legacy-2025")).toEqual({
			usd_price_micros: Math.round(9_990_000 * 1.12),
			usd_rate_date: "2025-03-12",
		});
	});

	test("resumes the conversion of a large backlog across runs without converting twice", async () => {
		const statements = [];
		for (let index = 0; index < 2_100; index += 14)
			statements.push(
				testEnv.DB.prepare(
					`INSERT INTO billing_catalog_purchases(id,project_id,financial_customer_id,product_id,status,purchased_at,purchased_price_micros,currency) VALUES ${Array.from({ length: 14 }, () => "(?,'731','legacy-customer','legacy-product','active','2026-10-05T10:00:00.000Z',1000000,'CHF')").join(",")}`,
				).bind(
					...Array.from(
						{ length: 14 },
						(_, offset) => `backlog-${String(index + offset).padStart(4, "0")}`,
					),
				),
			);
		await testEnv.DB.batch(statements);
		const pending = () =>
			testEnv.DB.prepare(
				"SELECT COUNT(*) AS count FROM billing_catalog_purchases WHERE id LIKE 'backlog-%' AND usd_rate_date IS NULL",
			).first<{ count: number }>();

		const first = await sync("2026-12-26T10:00:00.000Z");
		expect(first.converted.purchases).toBe(2_000);
		expect(await pending()).toEqual({ count: 100 });
		await testEnv.DB.prepare(
			"UPDATE billing_catalog_purchases SET usd_price_micros = -1 WHERE id = 'backlog-0000'",
		).run();

		const second = await sync("2026-12-26T10:05:00.000Z");
		expect(second.converted.purchases).toBe(100);
		expect(await pending()).toEqual({ count: 0 });
		expect(await purchaseRow("backlog-0000")).toMatchObject({ usd_price_micros: -1 });
		expect(await purchaseRow("backlog-2099")).toEqual({
			usd_price_micros: Math.round((1_000_000 * 1.05) / 0.95),
			usd_rate_date: "2026-10-05",
		});
	});

	test("records a failed ECB request without failing the job and retries after an hour", async () => {
		const failing = vi.fn(async () => new Response("unavailable", { status: 503 }));
		const failed = await sync("2026-12-28T17:00:00.000Z", failing);
		expect(failed.error).toMatch(/503/u);
		expect(
			await testEnv.DB.prepare(
				"SELECT last_error, last_attempt_at FROM billing_exchange_rate_sync WHERE source = 'ecb'",
			).first(),
		).toEqual({
			last_error: "ECB reference rates request failed with status 503",
			last_attempt_at: "2026-12-28T17:00:00.000Z",
		});
		await sync("2026-12-28T17:30:00.000Z", failing);
		expect(failing).toHaveBeenCalledTimes(1);
		const recovered = await sync("2026-12-28T18:01:00.000Z");
		expect(recovered.error).toBeNull();
		expect(requestedWindows.at(-1)).toEqual(["2026-12-25", "2026-12-28"]);
	});

	test("runs after the scheduled reconciliation through the billing queue", async () => {
		expect(isBillingQueueJob({ type: "billing.exchange_rates.sync" })).toBe(true);
		const send = vi.fn(async () => undefined);
		const result = await dispatchBillingJob(
			{ ...testEnv, BILLING_QUEUE: { send } as unknown as Queue },
			{ type: "billing.reconcile" },
		);
		expect(result).toMatchObject({ exchange_rate_sync_enqueued: 1 });
		expect(send).toHaveBeenCalledWith({ type: "billing.exchange_rates.sync" });

		vi.stubGlobal("fetch", ecb);
		await expect(
			dispatchBillingJob(testEnv, { type: "billing.exchange_rates.sync" }),
		).resolves.toMatchObject({ error: null });
	});
});

describe("display currency", () => {
	test("defaults to USD and saves the choice of the signed operator only", async () => {
		const path = `/internal/v1/admin/billing/${projectRef}/operator/display-currency`;
		const initial = await signedRequest("GET", path);
		expect(await initial.json()).toMatchObject({ display_currency: "USD" });
		expect((await signedRequest("PUT", path, { display_currency: "CHF" })).status).toBe(422);
		const saved = await signedRequest("PUT", path, { display_currency: "EUR" }, "member");
		expect(saved.status).toBe(200);
		expect(await saved.json()).toMatchObject({ display_currency: "EUR" });
		expect(
			(await (await signedRequest("GET", path)).json<{ display_currency: string }>())
				.display_currency,
		).toBe("EUR");
		const colleague = await signedRequest("GET", path, undefined, "owner", "currency-colleague");
		expect((await colleague.json<{ display_currency: string }>()).display_currency).toBe("USD");
		await signedRequest("PUT", path, { display_currency: "USD" });
	});

	test("purchase statistics total converted amounts and report purchases awaiting conversion", async () => {
		const statistics = async (query: string) => {
			const response = await ledger("GET", `/statistics?from=2026-10-01&to=2026-10-07${query}`);
			expect(response.status).toBe(200);
			return (await response.json<{ data: Record<string, any> }>()).data;
		};
		await testEnv.DB.prepare(
			"INSERT INTO billing_catalog_purchases(id,project_id,financial_customer_id,product_id,status,purchased_at,purchased_price_micros,currency) VALUES('awaiting-1','731','legacy-customer','legacy-product','active','2026-10-06T23:00:00.000Z',7000000,'XYZ'),('awaiting-eur','731','legacy-customer','legacy-product','active','2026-10-04T10:00:00.000Z',3000000,'EUR')",
		).run();
		await testEnv.DB.prepare(
			"DELETE FROM billing_catalog_purchases WHERE id LIKE 'backlog-%'",
		).run();

		const usd = await statistics("");
		const rows = await testEnv.DB.prepare(
			"SELECT usd_price_micros FROM billing_catalog_purchases WHERE project_id='731' AND status IN ('active','expired','cancelled','refunded') AND purchased_at >= '2026-10-01' AND purchased_at < '2026-10-08'",
		).all<{ usd_price_micros: number | null }>();
		const convertedUsd = rows.results.reduce((sum, row) => sum + (row.usd_price_micros ?? 0), 0);
		const unconverted = rows.results.filter((row) => row.usd_price_micros == null).length;
		expect(usd.display_currency).toBe("USD");
		expect(usd.totals_in_display_currency).toMatchObject({
			purchases: rows.results.length,
			gross_revenue_micros: convertedUsd,
			unconverted_purchases: unconverted,
		});
		expect(unconverted).toBe(2);

		const eur = await statistics("&display_currency=EUR");
		expect(eur.display_currency).toBe("EUR");
		expect(eur.totals_in_display_currency.unconverted_purchases).toBe(1);
		expect(
			eur.series_in_display_currency.find((row: { bucket: string }) => row.bucket === "2026-10-04"),
		).toEqual({
			bucket: "2026-10-04",
			purchases: 1,
			revenue_micros: 3_000_000,
			unconverted_purchases: 0,
		});
		const day = eur.series_in_display_currency.find(
			(row: { bucket: string }) => row.bucket === "2026-10-03",
		);
		expect(day).toMatchObject({ unconverted_purchases: 0 });
		expect(day.revenue_micros).toBe(
			Math.round(Math.round(9_990_000 * 1.02) / 1.02) +
				Math.round(Math.round((9_500_000 * 1.02) / 0.95) / 1.02),
		);
		expect(eur.totals_in_display_currency.refunded_micros).toBe(
			Math.round(Math.round(9_990_000 * 1.05) / 1.05) +
				Math.round(Math.round((9_500_000 * 1.06) / 0.95) / 1.06),
		);
		expect((await ledger("GET", "/statistics?display_currency=CHF")).status).toBe(422);

		await signedRequest(
			"PUT",
			`/internal/v1/admin/billing/${projectRef}/operator/display-currency`,
			{
				display_currency: "EUR",
			},
		);
		expect((await statistics("")).display_currency).toBe("EUR");
		const list = await ledger("GET", "/purchases?from=2026-10-03&to=2026-10-03");
		const purchases = (await list.json<{ data: Array<Record<string, unknown>> }>()).data;
		expect(purchases.find((row) => row.id === "legacy-eur")).toMatchObject({
			purchased_price_micros: 9_990_000,
			currency: "EUR",
			usd_price_micros: Math.round(9_990_000 * 1.02),
			display_currency: "EUR",
			display_price_micros: Math.round(Math.round(9_990_000 * 1.02) / 1.02),
		});
		await signedRequest(
			"PUT",
			`/internal/v1/admin/billing/${projectRef}/operator/display-currency`,
			{
				display_currency: "USD",
			},
		);
	});

	test("the customer profile shows the total spent once per store transaction in the display currency", async () => {
		const response = await signedRequest(
			"GET",
			`/internal/v1/admin/purchases/projects/${projectRef}/customers/currency-customer`,
		);
		expect(response.status).toBe(200);
		const body = await response.json<{
			display_currency: string;
			total_spent: Record<string, unknown>;
			transactions: Array<Record<string, unknown>>;
		}>();
		expect(body.display_currency).toBe("USD");
		expect(body.total_spent).toEqual({
			currency: "USD",
			purchases: 1,
			amount_micros: Math.round((9_500_000 * 1.02) / 0.95),
			unconverted_purchases: 0,
		});
		expect(body.transactions.find((row) => row.id === "tx-chf")).toMatchObject({
			price_micros: 9_500_000,
			currency: "chf",
			display_currency: "USD",
			display_price_micros: Math.round((9_500_000 * 1.02) / 0.95),
		});
	});
});
