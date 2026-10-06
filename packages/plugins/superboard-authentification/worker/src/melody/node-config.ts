import toml from "toml";

function isTable(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export function parseNodeVariables(source: string): Record<string, unknown> {
	const config: unknown = toml.parse(source);
	if (!isTable(config) || !isTable(config.vars)) throw new Error("Invalid Wrangler variables");
	return config.vars;
}
