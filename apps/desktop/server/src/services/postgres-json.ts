import type postgres from "postgres";

export function toPostgresJson(value: unknown): postgres.JSONValue {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new Error("Postgres JSON value is not serializable");
	}
	const parsed: unknown = JSON.parse(serialized);
	return requireJsonValue(parsed);
}

function requireJsonValue(value: unknown): postgres.JSONValue {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string"
	) {
		return value;
	}
	if (Array.isArray(value)) return value.map(requireJsonValue);
	if (typeof value === "object") {
		const result: Record<string, postgres.JSONValue> = {};
		for (const [key, nested] of Object.entries(value)) {
			result[key] = requireJsonValue(nested);
		}
		return result;
	}
	throw new Error("Postgres JSON value contains an unsupported value");
}
