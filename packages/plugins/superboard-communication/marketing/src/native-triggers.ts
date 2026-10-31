import type { MarketingSignalV1 } from "@superboard/contracts/analytics";

import { isRecord, plainText } from "./audience-shared.js";
import { failure } from "./auth.js";
import { attributeSignalRevenue } from "./revenue-attribution.js";
import type { Env, MarketingQueueJob } from "./types.js";
import { parseStoredJson } from "./validation.js";

/**
 * Native automation triggers. Each one maps a friendly business moment onto
 * the events SuperBoard actually emits (core collection, billing and the
 * Marketing audience itself). Journeys store them as `native:<key>`.
 */
type NativeTriggerEvent = { event_name: string; when?: Record<string, string[]> };
type NativeTrigger = {
	key: string;
	group: "purchases" | "subscriptions" | "acquisition" | "audience" | "dates";
	label: string;
	events: NativeTriggerEvent[];
};

const PURCHASE_VERIFIED = "superboard.analytics.purchase.verified.v1";
const INSTALLATION_CREATED = "superboard.analytics.installation.created.v1";

export const NATIVE_TRIGGERS: readonly NativeTrigger[] = [
	{
		key: "purchase_completed",
		group: "purchases",
		label: "Purchase completed",
		events: [
			{ event_name: "customer.purchase" },
			{ event_name: PURCHASE_VERIFIED, when: { event_type: ["initial_purchase"] } },
		],
	},
	{
		key: "refund_issued",
		group: "purchases",
		label: "Refund issued",
		events: [
			{ event_name: "customer.refund" },
			{ event_name: PURCHASE_VERIFIED, when: { event_type: ["refund", "chargeback"] } },
		],
	},
	{
		key: "subscription_started",
		group: "subscriptions",
		label: "Subscription started",
		events: [
			{
				event_name: PURCHASE_VERIFIED,
				when: { event_type: ["initial_purchase", "trial_converted"] },
			},
		],
	},
	{
		key: "subscription_renewed",
		group: "subscriptions",
		label: "Subscription renewed",
		events: [{ event_name: PURCHASE_VERIFIED, when: { event_type: ["renewal"] } }],
	},
	{
		key: "subscription_cancelled",
		group: "subscriptions",
		label: "Subscription cancelled",
		events: [{ event_name: PURCHASE_VERIFIED, when: { event_type: ["cancellation"] } }],
	},
	{
		key: "trial_converted",
		group: "subscriptions",
		label: "Trial converted",
		events: [{ event_name: PURCHASE_VERIFIED, when: { event_type: ["trial_converted"] } }],
	},
	{
		key: "dynamic_link_opened",
		group: "acquisition",
		label: "Dynamic link opened in the app",
		events: [{ event_name: "open" }, { event_name: "customer.open" }],
	},
	{
		key: "app_installed_from_link",
		group: "acquisition",
		label: "App installed from a link",
		events: [{ event_name: INSTALLATION_CREATED, when: { install_type: ["attributed"] } }],
	},
	{
		key: "app_installed",
		group: "acquisition",
		label: "App installed",
		events: [
			{ event_name: INSTALLATION_CREATED },
			{ event_name: "install" },
			{ event_name: "customer.install" },
		],
	},
	{
		key: "contact_created",
		group: "audience",
		label: "Contact created",
		events: [{ event_name: "marketing.contact.created" }],
	},
	{
		key: "contact_joined_list",
		group: "audience",
		label: "Contact joined a list",
		events: [{ event_name: "marketing.list.joined" }],
	},
	{
		key: "tag_added",
		group: "audience",
		label: "Tag added to a contact",
		events: [{ event_name: "marketing.tag.added" }],
	},
	{ key: "date_attribute", group: "dates", label: "Date or anniversary", events: [] },
];

/** Business moments with no event producer in SuperBoard today. */
export const UNAVAILABLE_NATIVE_TRIGGERS = [
	{ key: "subscription_expired", reason: "Billing maps store expirations to initial_purchase." },
	{ key: "trial_ending", reason: "No trial-will-end event is emitted." },
	{ key: "trial_ended", reason: "No trial-ended event is emitted." },
	{ key: "paywall_viewed", reason: "Paywall events stay in the paywall plugin tables." },
	{ key: "paywall_converted", reason: "Paywall events stay in the paywall plugin tables." },
	{ key: "dynamic_link_clicked", reason: "Link clicks stay in the dynamic links plugin tables." },
	{ key: "user_signed_up", reason: "Authentication emits no sign-up event." },
] as const;

export const NATIVE_PREFIX = "native:";
export const DATE_TRIGGER = "native:date_attribute";
const EVENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;
const ATTRIBUTE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;

export type DateTriggerSettings = {
	attribute: string;
	anniversary: boolean;
	offset_days: number;
	hour: number;
};

function matchesEvent(
	event: NativeTriggerEvent,
	signal: Pick<MarketingSignalV1, "event_name" | "properties">,
) {
	if (event.event_name !== signal.event_name) return false;
	return Object.entries(event.when ?? {}).every(([field, values]) =>
		values.includes(plainText(signal.properties?.[field])),
	);
}

/** Every `native:<key>` trigger an incoming signal satisfies. */
export function nativeTriggerKeys(signal: Pick<MarketingSignalV1, "event_name" | "properties">) {
	return NATIVE_TRIGGERS.filter((trigger) =>
		trigger.events.some((event) => matchesEvent(event, signal)),
	).map((trigger) => NATIVE_PREFIX + trigger.key);
}

/** An event key is a raw event name or a `native:<key>` trigger. */
export function eventKeyMatches(
	key: string,
	signal: Pick<MarketingSignalV1, "event_name" | "properties">,
) {
	return (
		key === signal.event_name ||
		(key.startsWith(NATIVE_PREFIX) && nativeTriggerKeys(signal).includes(key))
	);
}

export function validateEventKey(value: unknown, field: string, allowDate = false): string {
	const key = typeof value === "string" ? value.trim() : "";
	if (!EVENT_NAME.test(key)) throw failure(`${field}_invalid`, `${field} is invalid`);
	if (key.startsWith(NATIVE_PREFIX)) {
		const known = NATIVE_TRIGGERS.some((trigger) => NATIVE_PREFIX + trigger.key === key);
		if (!known || (!allowDate && key === DATE_TRIGGER))
			throw failure(`${field}_invalid`, `${field} is not a supported trigger`);
	}
	return key;
}

/** Extra trigger settings, currently the date-based trigger configuration. */
export function validateNativeTriggerSettings(
	eventName: string,
	source: Record<string, unknown>,
): { date?: DateTriggerSettings } {
	if (eventName.startsWith(NATIVE_PREFIX)) validateEventKey(eventName, "event_name", true);
	if (eventName !== DATE_TRIGGER) return {};
	const raw = isRecord(source.date) ? source.date : {};
	const attribute = typeof raw.attribute === "string" ? raw.attribute.trim() : "";
	if (!ATTRIBUTE.test(attribute))
		throw failure("date_attribute_invalid", "Choose the contact field that holds the date.");
	const offset = raw.offset_days === undefined ? 0 : Number(raw.offset_days);
	const hour = raw.hour === undefined ? 9 : Number(raw.hour);
	if (!Number.isInteger(offset) || offset < -365 || offset > 365)
		throw failure("date_offset_invalid", "The day offset must be between -365 and 365.");
	if (!Number.isInteger(hour) || hour < 0 || hour > 23)
		throw failure("date_hour_invalid", "The sending hour must be between 0 and 23.");
	return { date: { attribute, anniversary: raw.anniversary !== false, offset_days: offset, hour } };
}

/** Wait-until-event step: returns whether the step is still waiting or how it ended. */
export async function evaluateWaitStep(
	db: D1Database,
	enrollment: { id: string; project_id: number; subscriber_id: string },
	node: { id: string; event_name?: string; timeout_seconds?: number },
): Promise<
	| { waiting: true; expires_at: string }
	| { waiting: false; outcome: "true" | "false"; output: Record<string, unknown> }
> {
	const current = await db
		.prepare(
			"SELECT status, expires_at, matched_event_id FROM marketing_journey_waits WHERE project_id=? AND enrollment_id=? AND node_id=?",
		)
		.bind(enrollment.project_id, enrollment.id, node.id)
		.first<{ status: string; expires_at: string; matched_event_id: string | null }>();
	if (!current) {
		const expiresAt = new Date(
			Date.now() + Number(node.timeout_seconds ?? 86_400) * 1000,
		).toISOString();
		await db
			.prepare(
				`INSERT INTO marketing_journey_waits (project_id, enrollment_id, node_id, subscriber_id, event_key, expires_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, enrollment_id, node_id) DO NOTHING`,
			)
			.bind(
				enrollment.project_id,
				enrollment.id,
				node.id,
				enrollment.subscriber_id,
				node.event_name ?? "",
				expiresAt,
			)
			.run();
		return { waiting: true, expires_at: expiresAt };
	}
	if (current.status === "matched")
		return {
			waiting: false,
			outcome: "true",
			output: { waited_for: node.event_name, matched_event_id: current.matched_event_id },
		};
	if (current.status === "waiting" && Date.parse(current.expires_at) > Date.now())
		return { waiting: true, expires_at: current.expires_at };
	await db
		.prepare(
			"UPDATE marketing_journey_waits SET status='timed_out', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=? AND enrollment_id=? AND node_id=? AND status='waiting'",
		)
		.bind(enrollment.project_id, enrollment.id, node.id)
		.run();
	return {
		waiting: false,
		outcome: "false",
		output: { waited_for: node.event_name, timed_out: true },
	};
}

/** True when the enrollment already reached its journey goal and must stop. */
export async function enrollmentReachedGoal(
	db: D1Database,
	projectId: number,
	enrollmentId: string,
) {
	return Boolean(
		await db
			.prepare("SELECT 1 FROM marketing_journey_goals WHERE project_id=? AND enrollment_id=?")
			.bind(projectId, enrollmentId)
			.first(),
	);
}

async function wakeWaitingEnrollments(
	env: Env,
	projectId: number,
	subscriberId: string,
	signal: MarketingSignalV1,
) {
	const waits = await env.DB.prepare(
		"SELECT enrollment_id, node_id, event_key FROM marketing_journey_waits WHERE project_id=? AND subscriber_id=? AND status='waiting' LIMIT 100",
	)
		.bind(projectId, subscriberId)
		.all<{ enrollment_id: string; node_id: string; event_key: string }>();
	let woken = 0;
	for (const wait of waits.results) {
		if (!eventKeyMatches(wait.event_key, signal)) continue;
		const matched = await env.DB.prepare(
			`UPDATE marketing_journey_waits SET status='matched', matched_event_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE project_id=? AND enrollment_id=? AND node_id=? AND status='waiting' RETURNING enrollment_id`,
		)
			.bind(signal.event_id, projectId, wait.enrollment_id, wait.node_id)
			.first();
		if (!matched) continue;
		await env.DB.prepare(
			`UPDATE marketing_journey_enrollments SET status='active', next_run_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE project_id=? AND id=? AND status='waiting' AND current_node_id=?`,
		)
			.bind(projectId, wait.enrollment_id, wait.node_id)
			.run();
		await env.MARKETING_QUEUE.send({
			type: "marketing.journey.advance",
			projectId,
			enrollmentId: wait.enrollment_id,
		} satisfies MarketingQueueJob);
		woken += 1;
	}
	return woken;
}

async function reachJourneyGoals(
	db: D1Database,
	projectId: number,
	subscriberId: string,
	signal: MarketingSignalV1,
) {
	const rows = await db
		.prepare(
			`SELECT enrollment.id, enrollment.journey_id, version.definition_json
       FROM marketing_journey_enrollments enrollment
       JOIN marketing_journey_versions version ON version.project_id = enrollment.project_id
         AND version.journey_id = enrollment.journey_id AND version.version = enrollment.journey_version
       WHERE enrollment.project_id = ? AND enrollment.subscriber_id = ?
         AND enrollment.status IN ('active', 'waiting', 'processing')
         AND instr(version.definition_json, '"goal"') > 0
       LIMIT 100`,
		)
		.bind(projectId, subscriberId)
		.all<{ id: string; journey_id: string; definition_json: string }>();
	let reached = 0;
	for (const row of rows.results) {
		const goal = parseStoredJson<{ goal?: { event_name?: string } }>(row.definition_json, {}).goal;
		if (!goal?.event_name || !eventKeyMatches(goal.event_name, signal)) continue;
		await db.batch([
			db
				.prepare(
					`INSERT INTO marketing_journey_goals (project_id, enrollment_id, journey_id, event_id)
           VALUES (?, ?, ?, ?) ON CONFLICT(project_id, enrollment_id) DO NOTHING`,
				)
				.bind(projectId, row.id, row.journey_id, signal.event_id),
			db
				.prepare(
					`UPDATE marketing_journey_enrollments SET status='exited', last_error=NULL,
             completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE project_id=? AND id=? AND status IN ('active','waiting')`,
				)
				.bind(projectId, row.id),
		]);
		reached += 1;
	}
	return reached;
}

/**
 * Runs for every signal matched to a contact, before journey entry: revenue
 * attribution, journey goals (converted contacts exit) and waiting steps.
 */
export async function onSubscriberSignal(
	env: Env,
	projectId: number,
	subscriberId: string,
	signal: MarketingSignalV1,
) {
	const revenue = await attributeSignalRevenue(env.DB, projectId, subscriberId, signal);
	const goals = await reachJourneyGoals(env.DB, projectId, subscriberId, signal);
	const woken = await wakeWaitingEnrollments(env, projectId, subscriberId, signal);
	return { revenue_attributed: revenue.attributed, goals_reached: goals, waits_resumed: woken };
}

/** Goal conversions and attributed revenue shown with journey statistics. */
export async function journeyOutcomes(db: D1Database, projectId: number, journeyId: string) {
	const row = await db
		.prepare(
			`SELECT
        (SELECT COUNT(*) FROM marketing_journey_goals WHERE project_id = ? AND journey_id = ?) AS goals_reached,
        (SELECT COALESCE(SUM(revenue_cents), 0) FROM marketing_revenue_attributions
          WHERE project_id = ? AND source_type = 'journey' AND source_id = ?) AS revenue_cents`,
		)
		.bind(projectId, journeyId, projectId, journeyId)
		.first<{ goals_reached: number; revenue_cents: number }>();
	return {
		goals_reached: Number(row?.goals_reached ?? 0),
		attributed_revenue: Number(row?.revenue_cents ?? 0) / 100,
	};
}
