export function unwrapMigratedPayload(payload: unknown): unknown {
	if (
		typeof payload !== "object" ||
		payload === null ||
		!("payload_json" in payload) ||
		typeof payload.payload_json !== "string"
	) {
		return payload;
	}
	try {
		return JSON.parse(payload.payload_json) as unknown;
	} catch {
		throw new Error("PLUGIN_STORE_PAYLOAD_INVALID");
	}
}
