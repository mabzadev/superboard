import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { beforeAll, describe, expect, test } from "vitest";

import { syncBillingExchangeRates } from "../../../../../../packages/plugins/superboard-core/api/src/lib/billing-exchange-rates.js";
import worker from "../../../../../../packages/plugins/superboard-monetization/billing/src/index.js";
import { billingTestEnv as testEnv, createExecutionContext } from "./apply-migrations.js";

const projectRef = "74-test";
const migrationName = "0074_billing_operator_display_currency.sql";
const ecbUnitsPerEur: Record<string, number> = {
	USD: 1.1,
	JPY: 160,
	GBP: 0.85,
	AUD: 1.65,
	CAD: 1.5,
	BRL: 6,
	KRW: 1500,
	CNY: 7.8,
	MXN: 20,
	SEK: 11.5,
	PLN: 4.3,
	CHF: 0.95,
};
const secondaryUnitsPerEur = {
	usd: 1.12,
	sar: 4.2,
	aed: 4.11,
	vnd: 28_000,
	jpy: 170,
	btc: 0.00001,
};
const requests: string[] = [];
const missingDays = new Set<string>();
const primaryDownDays = new Set<string>();
const downDays = new Set<string>();

function nextDay(day: string) {
	const date = new Date(`${day}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
}

function ecbCsv(from: string, to: string) {
	const lines = ["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE"];
	for (let day = from; day <= to; day = nextDay(day)) {
		const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
		if (weekday === 0 || weekday === 6) continue;
		for (const [currency, rate] of Object.entries(ecbUnitsPerEur))
			lines.push(`EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${day},${rate}`);
	}
	return lines.length > 1 ? `${lines.join("\n")}\n` : "";
}

async function rates(input: RequestInfo | URL): Promise<Response> {
	const url = new URL(input instanceof Request ? input.url : input);
	if (url.hostname === "data-api.ecb.europa.eu")
		return new Response(
			ecbCsv(url.searchParams.get("startPeriod")!, url.searchParams.get("endPeriod")!),
		);
	const primary =
		/^\/npm\/@fawazahmed0\/currency-api@(\d{4}-\d{2}-\d{2})\/v1\/currencies\/eur\.min\.json$/u.exec(
			url.pathname,
		);
	const mirror = /^(\d{4}-\d{2}-\d{2})\.currency-api\.pages\.dev$/u.exec(url.hostname);
	const day =
		url.hostname === "cdn.jsdelivr.net"
			? primary?.[1]
			: mirror && url.pathname === "/v1/currencies/eur.min.json"
				? mirror[1]
				: undefined;
	if (!day) throw new Error(`Unexpected rate request ${url.toString()}`);
	requests.push(`${url.hostname === "cdn.jsdelivr.net" ? "primary" : "mirror"}:${day}`);
	if (downDays.has(day) || (primaryDownDays.has(day) && url.hostname === "cdn.jsdelivr.net"))
		return new Response("unavailable", { status: 503 });
	if (missingDays.has(day)) return new Response("Not found", { status: 404 });
	return Response.json({ date: day, eur: { ...secondaryUnitsPerEur, eur: 1 } });
}

function sync(now: string) {
	return syncBillingExchangeRates(testEnv, { now: new Date(now), fetcher: rates });
}

async function signedRequest(
	method: string,
	path: string,
	options: { body?: unknown; operatorId?: string | null; role?: string } = {},
) {
	const operatorId = options.operatorId === undefined ? "operator-a" : options.operatorId;
	const headers = await createProjectContextHeaders(
		{
			module: "billing",
			method,
			pathname: new URL(path, "https://billing.internal").pathname,
			projectId: 741,
			projectRef,
			instanceId: 74,
			environment: "test",
			actorId: operatorId ? 0 : 7,
			...(operatorId ? { operatorId } : {}),
			role: options.role ?? "owner",
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
			...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
		}) as Request<unknown, IncomingRequestCfProperties>,
		{ ...testEnv, CREDENTIAL_KEY_SCOPE: "billing" },
		createExecutionContext(),
	);
}

const preferencePath = `/internal/v1/admin/billing/${projectRef}/operator/display-currency`;

async function setDisplayCurrency(operatorId: string, currency: string) {
	const response = await signedRequest("PUT", preferencePath, {
		operatorId,
		role: "member",
		body: { display_currency: currency },
	});
	expect(response.status).toBe(200);
	return response.json<{ display_currency: string }>();
}

async function statistics(operatorId: string, query = "") {
	const response = await signedRequest(
		"GET",
		`/internal/v1/catalog-ledger/statistics?from=2026-10-01&to=2026-10-09${query}`,
		{ operatorId },
	);
	expect(response.status).toBe(200);
	return (await response.json<{ data: Record<string, any> }>()).data;
}

async function insertPurchase(id: string, purchasedAt: string, micros: number, currency: string) {
	await testEnv.DB.prepare(
		"INSERT INTO billing_catalog_purchases(id,project_id,financial_customer_id,product_id,status,purchased_at,purchased_price_micros,currency) VALUES(?,'741','display-customer','display-product','active',?,?,?)",
	)
		.bind(id, purchasedAt, micros, currency)
		.run();
}

async function purchaseRow(id: string) {
	return testEnv.DB.prepare(
		"SELECT usd_price_micros, usd_rate_date FROM billing_catalog_purchases WHERE id = ?",
	)
		.bind(id)
		.first<{ usd_price_micros: number | null; usd_rate_date: string | null }>();
}

async function tableExists(name: string) {
	const row = await testEnv.DB.prepare(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
	)
		.bind(name)
		.first();
	return row !== null;
}

const fromSar = (micros: number) =>
	Math.round((micros * secondaryUnitsPerEur.usd) / secondaryUnitsPerEur.sar);

beforeAll(async () => {
	await testEnv.DB.batch([
		testEnv.DB.prepare(
			"INSERT INTO instances(id,api_key,uri_scheme) VALUES(74,'display-test','display-test')",
		),
		testEnv.DB.prepare(
			"INSERT INTO projects(id,instance_id,is_test,name,identifier) VALUES(741,74,1,'Display','display-test')",
		),
		testEnv.DB.prepare(
			"INSERT INTO billing_catalog_financial_customers(id,project_id,external_customer_id) VALUES('display-customer','741','display-user')",
		),
		testEnv.DB.prepare(
			"INSERT INTO billing_customers(id,project_id,primary_app_user_id) VALUES('display-buyer','741','display-buyer')",
		),
	]);
});

describe("operator display currency migration", () => {
	test("reopens amounts closed without an exchange rate after an interrupted attempt", async () => {
		const migration = testEnv.TEST_MIGRATIONS.find((item) => item.name === migrationName);
		expect(migration).toBeDefined();
		await testEnv.DB.batch(
			[
				"DROP TABLE billing_operator_currency_preferences",
				"DROP TABLE billing_exchange_rate_days",
			].map((query) => testEnv.DB.prepare(query)),
		);
		await testEnv.DB.batch([
			testEnv.DB.prepare(
				"INSERT INTO billing_catalog_purchases(id,project_id,financial_customer_id,product_id,status,purchased_at,purchased_price_micros,currency,usd_price_micros,usd_rate_date) VALUES('closed-sar','741','display-customer','display-product','active','2026-10-05T12:00:00.000Z',4200000,'SAR',NULL,'2026-10-05'),('converted-eur','741','display-customer','display-product','active','2026-10-05T12:00:00.000Z',1000000,'EUR',1100000,'2026-10-05')",
			),
			testEnv.DB.prepare(
				"INSERT INTO billing_catalog_refunds(id,project_id,purchase_id,status,amount_micros,currency,requested_at,usd_amount_micros,usd_rate_date) VALUES('closed-refund','741','closed-sar','completed',4200000,'SAR','2026-10-06T09:00:00.000Z',NULL,'2026-10-06')",
			),
			testEnv.DB.prepare(
				"INSERT INTO billing_transactions(id,project_id,customer_id,store,environment,store_transaction_id,event_type,status,price_micros,currency,purchased_at,raw_payload,usd_price_micros,usd_rate_date) VALUES('closed-tx','741','display-buyer','apple','sandbox','store-sar','PURCHASED','active',8400000,'SAR','2026-10-05T10:00:00.000Z','{}',NULL,'2026-10-05')",
			),
		]);

		await expect(
			testEnv.DB.batch([
				...migration!.queries.map((query) => testEnv.DB.prepare(query)),
				testEnv.DB.prepare("INSERT INTO billing_missing_table VALUES (1)"),
			]),
		).rejects.toThrow();
		expect(await tableExists("billing_operator_currency_preferences")).toBe(false);
		expect(await purchaseRow("closed-sar")).toEqual({
			usd_price_micros: null,
			usd_rate_date: "2026-10-05",
		});

		await testEnv.DB.batch(migration!.queries.map((query) => testEnv.DB.prepare(query)));
		await testEnv.DB.batch(migration!.queries.map((query) => testEnv.DB.prepare(query)));

		expect(await tableExists("billing_operator_currency_preferences")).toBe(true);
		expect(await tableExists("billing_exchange_rate_days")).toBe(true);
		expect(await purchaseRow("closed-sar")).toEqual({
			usd_price_micros: null,
			usd_rate_date: null,
		});
		expect(await purchaseRow("converted-eur")).toEqual({
			usd_price_micros: 1_100_000,
			usd_rate_date: "2026-10-05",
		});
		expect(
			await testEnv.DB.prepare(
				"SELECT (SELECT usd_rate_date FROM billing_catalog_refunds WHERE id = 'closed-refund') AS refund, (SELECT usd_rate_date FROM billing_transactions WHERE id = 'closed-tx') AS tx",
			).first(),
		).toEqual({ refund: null, tx: null });
	});
});

describe("secondary exchange rate source", () => {
	test("converts currencies the ECB does not publish at the rate of their day and keeps ECB rates", async () => {
		await insertPurchase("aed-tuesday", "2026-10-06T08:00:00.000Z", 4_110_000, "AED");
		await insertPurchase("vnd-wednesday", "2026-10-07T08:00:00.000Z", 280_000_000_000, "VND");
		await insertPurchase("xyz-tuesday", "2026-10-06T09:00:00.000Z", 1_000_000, "XYZ");
		await insertPurchase("jpy-wednesday", "2026-10-07T09:00:00.000Z", 1_600_000_000, "JPY");

		const summary = await sync("2026-10-09T18:00:00.000Z");

		expect(summary).toMatchObject({
			error: null,
			secondary_error: null,
			secondary_days_checked: 3,
		});
		expect(requests).toEqual(["primary:2026-10-05", "primary:2026-10-06", "primary:2026-10-07"]);
		expect(await purchaseRow("closed-sar")).toEqual({
			usd_price_micros: fromSar(4_200_000),
			usd_rate_date: "2026-10-05",
		});
		expect(await purchaseRow("aed-tuesday")).toEqual({
			usd_price_micros: Math.round((4_110_000 * 1.12) / 4.11),
			usd_rate_date: "2026-10-06",
		});
		expect(await purchaseRow("vnd-wednesday")).toEqual({
			usd_price_micros: Math.round((280_000_000_000 * 1.12) / 28_000),
			usd_rate_date: "2026-10-07",
		});
		expect(await purchaseRow("jpy-wednesday")).toEqual({
			usd_price_micros: Math.round((1_600_000_000 * 1.1) / 160),
			usd_rate_date: "2026-10-07",
		});
		expect(await purchaseRow("xyz-tuesday")).toEqual({
			usd_price_micros: null,
			usd_rate_date: "2026-10-06",
		});
		expect(
			await testEnv.DB.prepare(
				"SELECT usd_amount_micros FROM billing_catalog_refunds WHERE id = 'closed-refund'",
			).first(),
		).toEqual({ usd_amount_micros: fromSar(4_200_000) });
		expect(
			await testEnv.DB.prepare(
				"SELECT currency, units_per_eur, source FROM billing_exchange_rates WHERE rate_date = '2026-10-05' AND currency IN ('SAR','JPY','USD','BTC') ORDER BY currency",
			).all(),
		).toMatchObject({
			results: [
				{ currency: "JPY", units_per_eur: 160, source: "ecb" },
				{ currency: "SAR", units_per_eur: (4.2 * 1.1) / 1.12, source: "currency-api" },
				{ currency: "USD", units_per_eur: 1.1, source: "ecb" },
			],
		});
		expect(
			await testEnv.DB.prepare(
				"SELECT currency FROM billing_exchange_rates WHERE rate_date = '2026-10-05' AND source = 'currency-api' ORDER BY currency",
			).all(),
		).toMatchObject({ results: [{ currency: "AED" }, { currency: "SAR" }, { currency: "VND" }] });
		expect(
			await testEnv.DB.prepare(
				"SELECT rate_date, status FROM billing_exchange_rate_days WHERE source = 'currency-api' ORDER BY rate_date",
			).all(),
		).toMatchObject({
			results: [
				{ rate_date: "2026-10-05", status: "loaded" },
				{ rate_date: "2026-10-06", status: "loaded" },
				{ rate_date: "2026-10-07", status: "loaded" },
			],
		});

		const recorded = await signedRequest("POST", "/internal/v1/catalog-ledger/purchases", {
			body: {
				financial_customer_id: "display-customer",
				product_id: "display-product",
				product_snapshot: {
					identifier: "display",
					display_name: "Display",
					product_type: "non_consumable",
					status: "active",
				},
				store: "apple",
				environment: "sandbox",
				external_transaction_id: "aed-at-insert",
				purchased_at: "2026-10-06T12:00:00.000Z",
				purchased_price_micros: 8_220_000,
				currency: "AED",
			},
		});
		expect(recorded.status).toBe(201);
		expect((await recorded.json<{ data: Record<string, unknown> }>()).data).toMatchObject({
			usd_price_micros: Math.round((8_220_000 * 1.12) / 4.11),
			usd_rate_date: "2026-10-06",
		});
	});

	test("uses the mirror when the primary address fails", async () => {
		requests.length = 0;
		primaryDownDays.add("2026-10-08");
		await insertPurchase("sar-thursday", "2026-10-08T08:00:00.000Z", 8_400_000, "SAR");

		const summary = await sync("2026-10-09T18:10:00.000Z");

		expect(summary.secondary_error).toBeNull();
		expect(requests).toEqual(["primary:2026-10-08", "mirror:2026-10-08"]);
		expect(await purchaseRow("sar-thursday")).toEqual({
			usd_price_micros: fromSar(8_400_000),
			usd_rate_date: "2026-10-08",
		});
	});

	test("closes a purchase without an amount when the source never published its day and waits for a recent day", async () => {
		requests.length = 0;
		missingDays.add("2026-10-02");
		missingDays.add("2026-10-09");
		await insertPurchase("sar-old-gap", "2026-10-02T08:00:00.000Z", 4_200_000, "SAR");
		await insertPurchase("sar-today", "2026-10-09T08:00:00.000Z", 4_200_000, "SAR");

		const first = await sync("2026-10-09T18:20:00.000Z");

		expect(first.secondary_error).toBeNull();
		expect(requests).toEqual([
			"primary:2026-10-02",
			"mirror:2026-10-02",
			"primary:2026-10-09",
			"mirror:2026-10-09",
		]);
		expect(await purchaseRow("sar-old-gap")).toEqual({
			usd_price_micros: null,
			usd_rate_date: "2026-10-02",
		});
		expect(await purchaseRow("sar-today")).toEqual({ usd_price_micros: null, usd_rate_date: null });

		missingDays.delete("2026-10-09");
		await sync("2026-10-09T18:30:00.000Z");
		expect(await purchaseRow("sar-today")).toEqual({
			usd_price_micros: fromSar(4_200_000),
			usd_rate_date: "2026-10-09",
		});
	});

	test("records a failure of both addresses without failing the job and retries an hour later", async () => {
		requests.length = 0;
		downDays.add("2026-10-01");
		await insertPurchase("sar-down", "2026-10-01T08:00:00.000Z", 4_200_000, "SAR");

		const failed = await sync("2026-10-09T19:00:00.000Z");

		expect(failed.error).toBeNull();
		expect(failed.secondary_error).toBe("Currency API request failed with status 503");
		expect(requests).toEqual(["primary:2026-10-01", "mirror:2026-10-01"]);
		expect(
			await testEnv.DB.prepare(
				"SELECT last_error, last_attempt_at FROM billing_exchange_rate_sync WHERE source = 'currency-api'",
			).first(),
		).toEqual({
			last_error: "Currency API request failed with status 503",
			last_attempt_at: "2026-10-09T19:00:00.000Z",
		});
		expect(await purchaseRow("sar-down")).toEqual({ usd_price_micros: null, usd_rate_date: null });

		await sync("2026-10-09T19:30:00.000Z");
		expect(requests).toHaveLength(2);

		downDays.delete("2026-10-01");
		const recovered = await sync("2026-10-09T20:01:00.000Z");
		expect(recovered.secondary_error).toBeNull();
		expect(await purchaseRow("sar-down")).toEqual({
			usd_price_micros: fromSar(4_200_000),
			usd_rate_date: "2026-10-01",
		});
		expect(
			await testEnv.DB.prepare(
				"SELECT last_error FROM billing_exchange_rate_sync WHERE source = 'currency-api'",
			).first(),
		).toEqual({ last_error: null });
	});

	test("loads at most ten days per run and resumes with the next days", async () => {
		requests.length = 0;
		const days = [
			"2026-09-14",
			"2026-09-15",
			"2026-09-16",
			"2026-09-17",
			"2026-09-18",
			"2026-09-21",
			"2026-09-22",
			"2026-09-23",
			"2026-09-24",
			"2026-09-25",
			"2026-09-28",
			"2026-09-29",
		];
		for (const day of days)
			await insertPurchase(`aed-${day}`, `${day}T10:00:00.000Z`, 4_110_000, "AED");

		const first = await sync("2026-10-09T20:10:00.000Z");
		expect(first.secondary_days_checked).toBe(10);
		expect(requests).toEqual(days.slice(0, 10).map((day) => `primary:${day}`));
		expect(await purchaseRow("aed-2026-09-25")).toMatchObject({ usd_rate_date: "2026-09-25" });
		expect(await purchaseRow("aed-2026-09-28")).toEqual({
			usd_price_micros: null,
			usd_rate_date: null,
		});

		const second = await sync("2026-10-09T20:20:00.000Z");
		expect(second.secondary_days_checked).toBe(2);
		expect(requests.slice(10)).toEqual(["primary:2026-09-28", "primary:2026-09-29"]);
		expect(await purchaseRow("aed-2026-09-29")).toEqual({
			usd_price_micros: Math.round((4_110_000 * 1.12) / 4.11),
			usd_rate_date: "2026-09-29",
		});
	});

	test("closes purchases older than the source history without requesting it", async () => {
		requests.length = 0;
		await insertPurchase("sar-2024", "2024-02-27T10:00:00.000Z", 4_200_000, "SAR");
		for (let run = 0; run < 7; run += 1)
			await sync(`2026-10-09T21:${String(run).padStart(2, "0")}:00.000Z`);

		expect(await purchaseRow("sar-2024")).toEqual({
			usd_price_micros: null,
			usd_rate_date: "2024-02-27",
		});
		expect(requests.filter((request) => request.endsWith("2024-02-27"))).toEqual([]);
		expect(
			await testEnv.DB.prepare(
				"SELECT status FROM billing_exchange_rate_days WHERE source = 'currency-api' AND rate_date = '2024-02-27'",
			).first(),
		).toEqual({ status: "unavailable" });
	});
});

describe("operator display currency", () => {
	test("offers the twelve RevenueCat currencies and keeps each operator's choice separate", async () => {
		const initial = await signedRequest("GET", preferencePath);
		expect(await initial.json()).toEqual({
			display_currency: "USD",
			available_currencies: [
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
			],
		});
		expect(
			(
				await signedRequest("PUT", preferencePath, {
					body: { display_currency: "CHF" },
				})
			).status,
		).toBe(422);
		expect(
			(
				await signedRequest("PUT", preferencePath, {
					operatorId: null,
					body: { display_currency: "EUR" },
				})
			).status,
		).toBe(403);

		expect(await setDisplayCurrency("operator-a", "JPY")).toMatchObject({
			display_currency: "JPY",
		});
		const other = await signedRequest("GET", preferencePath, { operatorId: "operator-b" });
		expect(await other.json()).toMatchObject({ display_currency: "USD" });

		await setDisplayCurrency("operator-b", "KRW");
		const mine = await signedRequest("GET", preferencePath, { operatorId: "operator-a" });
		expect(await mine.json()).toMatchObject({ display_currency: "JPY" });
		expect(
			await testEnv.DB.prepare(
				"SELECT operator_id, display_currency FROM billing_operator_currency_preferences WHERE instance_id = 74 ORDER BY operator_id",
			).all(),
		).toMatchObject({
			results: [
				{ operator_id: "operator-a", display_currency: "JPY" },
				{ operator_id: "operator-b", display_currency: "KRW" },
			],
		});
	});

	test("statistics, purchases and the customer profile follow the signed operator's currency", async () => {
		const usdOf = await testEnv.DB.prepare(
			"SELECT id, usd_price_micros FROM billing_catalog_purchases WHERE project_id = '741' AND usd_price_micros IS NOT NULL AND purchased_at >= '2026-10-01' AND purchased_at < '2026-10-10'",
		).all<{ id: string; usd_price_micros: number }>();
		const inCurrency = (unitsPerEur: number) =>
			usdOf.results.reduce(
				(sum, row) => sum + Math.round((row.usd_price_micros * unitsPerEur) / 1.1),
				0,
			);

		const yen = await statistics("operator-a");
		const won = await statistics("operator-b");
		const pounds = await statistics("operator-a", "&display_currency=GBP");
		const nobody = await statistics("operator-c");

		expect(yen.display_currency).toBe("JPY");
		expect(won.display_currency).toBe("KRW");
		expect(pounds.display_currency).toBe("GBP");
		expect(nobody.display_currency).toBe("USD");
		const jpyPurchase = 1_600_000_000;
		const jpyUsd = Math.round((jpyPurchase * 1.1) / 160);
		expect(yen.totals_in_display_currency.gross_revenue_micros).toBe(
			inCurrency(160) - Math.round((jpyUsd * 160) / 1.1) + jpyPurchase,
		);
		expect(won.totals_in_display_currency.gross_revenue_micros).toBe(inCurrency(1500));
		expect(yen.totals_in_display_currency.unconverted_purchases).toBe(
			won.totals_in_display_currency.unconverted_purchases,
		);

		const list = await signedRequest(
			"GET",
			"/internal/v1/catalog-ledger/purchases?from=2026-10-06&to=2026-10-06",
			{ operatorId: "operator-b" },
		);
		const purchases = (await list.json<{ data: Array<Record<string, unknown>> }>()).data;
		expect(purchases.find((row) => row.id === "aed-tuesday")).toMatchObject({
			purchased_price_micros: 4_110_000,
			currency: "AED",
			display_currency: "KRW",
			display_price_micros: Math.round((Math.round((4_110_000 * 1.12) / 4.11) * 1500) / 1.1),
		});

		const detail = await signedRequest("GET", "/internal/v1/catalog-ledger/purchases/aed-tuesday");
		expect((await detail.json<{ data: Record<string, unknown> }>()).data).toMatchObject({
			display_currency: "JPY",
			usd_rate_date: "2026-10-06",
			usd_rate_source: "currency-api",
		});
		const ecbDetail = await signedRequest(
			"GET",
			"/internal/v1/catalog-ledger/purchases/jpy-wednesday",
		);
		expect((await ecbDetail.json<{ data: Record<string, unknown> }>()).data).toMatchObject({
			display_price_micros: jpyPurchase,
			usd_rate_source: "ecb",
		});

		const customer = async (operatorId: string) => {
			const response = await signedRequest(
				"GET",
				`/internal/v1/admin/purchases/projects/${projectRef}/customers/display-buyer`,
				{ operatorId },
			);
			expect(response.status).toBe(200);
			return response.json<{ display_currency: string; total_spent: Record<string, unknown> }>();
		};
		const transactionUsd = fromSar(8_400_000);
		expect(await customer("operator-a")).toMatchObject({
			display_currency: "JPY",
			total_spent: {
				currency: "JPY",
				purchases: 1,
				amount_micros: Math.round((transactionUsd * 160) / 1.1),
			},
		});
		expect(await customer("operator-c")).toMatchObject({
			display_currency: "USD",
			total_spent: { currency: "USD", amount_micros: transactionUsd },
		});
	});
});
