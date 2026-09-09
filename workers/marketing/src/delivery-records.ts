import type { EmailSmtpTransportMessage } from "@superboard/contracts/email";

export async function freezeDeliveryMessage(
	db: D1Database,
	projectId: number,
	deliveryId: string,
	create: () => Promise<EmailSmtpTransportMessage>,
	purpose = "legacy",
	locale: string | null = null,
): Promise<EmailSmtpTransportMessage> {
	const previous = await db
		.prepare(
			"SELECT message_json FROM email_studio_transports WHERE project_id=? AND delivery_id=?",
		)
		.bind(projectId, deliveryId)
		.first<{ message_json: string }>();
	if (previous) return JSON.parse(previous.message_json) as EmailSmtpTransportMessage;
	const message = await create();
	await db
		.prepare(
			"INSERT INTO email_studio_transports (project_id,delivery_id,message_json,purpose,locale) VALUES (?,?,?,?,?) ON CONFLICT(project_id,delivery_id) DO NOTHING",
		)
		.bind(projectId, deliveryId, JSON.stringify(message), purpose, locale)
		.run();
	const saved = await db
		.prepare(
			"SELECT message_json FROM email_studio_transports WHERE project_id=? AND delivery_id=?",
		)
		.bind(projectId, deliveryId)
		.first<{ message_json: string }>();
	if (!saved) throw new Error("EMAIL_SNAPSHOT_UNAVAILABLE");
	return JSON.parse(saved.message_json) as EmailSmtpTransportMessage;
}

export function recordTransportStatus(
	db: D1Database,
	projectId: number,
	deliveryId: string,
	status: "sent" | "failed" | "outcome_unknown",
	providerId?: string,
) {
	return db
		.prepare(
			"UPDATE email_studio_transports SET status=?,provider_message_id=COALESCE(?,provider_message_id) WHERE project_id=? AND delivery_id=?",
		)
		.bind(status, providerId ?? null, projectId, deliveryId)
		.run();
}

export function eraseStudioRecipientStatements(
	db: D1Database,
	projectId: number,
	subscriberId: string,
): D1PreparedStatement[] {
	const values = [projectId, projectId, subscriberId, projectId, subscriberId];
	return [
		db
			.prepare(
				"DELETE FROM email_studio_transports WHERE project_id=? AND delivery_id IN (SELECT id FROM email_deliveries WHERE project_id=? AND subscriber_id=? UNION SELECT id FROM marketing_journey_deliveries WHERE project_id=? AND subscriber_id=?)",
			)
			.bind(...values),
		db
			.prepare(
				"DELETE FROM email_studio_send_attempts WHERE project_id=? AND delivery_id IN (SELECT id FROM email_deliveries WHERE project_id=? AND subscriber_id=? UNION SELECT id FROM marketing_journey_deliveries WHERE project_id=? AND subscriber_id=?)",
			)
			.bind(...values),
		db
			.prepare(
				"DELETE FROM email_studio_deliveries WHERE project_id=? AND delivery_id IN (SELECT id FROM email_deliveries WHERE project_id=? AND subscriber_id=? UNION SELECT id FROM marketing_journey_deliveries WHERE project_id=? AND subscriber_id=?)",
			)
			.bind(...values),
	];
}
