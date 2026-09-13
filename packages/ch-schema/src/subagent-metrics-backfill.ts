import { createHash, type Hash } from "node:crypto";

export interface CanonicalSessionRevision {
	readonly content: string;
	readonly filterVersion: number;
	readonly gitBranch?: string | null;
	readonly gitRemote: string;
	readonly gitSha?: string | null;
	readonly lastInteractionDateMs: number;
	readonly packageName: string;
	readonly packageType: string;
	readonly projectPath: string;
	readonly sessionDateMs: number;
	readonly subagents?: Readonly<Record<string, string>>;
	readonly tag?: string | null;
}

export function canonicalSessionRevisionDigest(
	revision: CanonicalSessionRevision,
): string {
	const hash = createHash("sha256");
	updateNamedField(hash, "content", revision.content);
	updateNamedField(hash, "sessionDate", String(revision.sessionDateMs));
	updateNamedField(
		hash,
		"lastInteractionDate",
		String(revision.lastInteractionDateMs),
	);
	updateNamedField(hash, "projectPath", revision.projectPath);
	updateNamedField(hash, "gitRemote", revision.gitRemote);
	updateNamedField(hash, "packageName", revision.packageName);
	updateNamedField(hash, "packageType", revision.packageType);
	updateNamedField(hash, "filterVersion", String(revision.filterVersion));
	updateNamedNullableField(hash, "gitBranch", revision.gitBranch);
	updateNamedNullableField(hash, "gitSha", revision.gitSha);
	updateNamedNullableField(hash, "tag", revision.tag);

	if (revision.subagents !== undefined) {
		const subagents = Object.entries(revision.subagents).sort(
			([left], [right]) =>
				Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
		);
		updateNamedField(hash, "subagentCount", String(subagents.length));
		for (const [agentId, content] of subagents) {
			updateNamedField(hash, "subagentId", agentId);
			updateNamedField(hash, "subagentContent", content);
		}
	}

	return hash.digest("hex");
}

export function buildCanonicalRevisionDigestSql(
	alias: string,
	includeSubagents: boolean,
): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(alias)) {
		throw new Error(`Unsafe ClickHouse alias: ${alias}`);
	}

	const value = (column: string) => `toString(${alias}.${column})`;
	const fields = [
		namedSqlField("content", value("content")),
		namedSqlField(
			"sessionDate",
			`toString(toUnixTimestamp64Milli(${alias}.session_date))`,
		),
		namedSqlField(
			"lastInteractionDate",
			`toString(toUnixTimestamp64Milli(${alias}.last_interaction_date))`,
		),
		namedSqlField("projectPath", value("project_path")),
		namedSqlField("gitRemote", value("git_remote")),
		namedSqlField("packageName", value("package_name")),
		namedSqlField("packageType", value("package_type")),
		namedSqlField("filterVersion", value("filter_version")),
		namedNullableSqlField("gitBranch", `${alias}.git_branch`),
		namedNullableSqlField("gitSha", `${alias}.git_sha`),
		namedNullableSqlField("tag", `${alias}.tag`),
	];

	if (includeSubagents) {
		const entries = `arraySort(entry -> tupleElement(entry, 1), arrayZip(mapKeys(${alias}.subagents), mapValues(${alias}.subagents)))`;
		fields.push(
			namedSqlField(
				"subagentCount",
				`toString(length(mapKeys(${alias}.subagents)))`,
			),
			`arrayStringConcat(arrayMap(entry -> concat(${sqlLiteral(framedConstant("subagentId"))}, ${framedSql("tupleElement(entry, 1)")}, ${sqlLiteral(framedConstant("subagentContent"))}, ${framedSql("tupleElement(entry, 2)")}), ${entries}), '')`,
		);
	}

	return `lower(hex(SHA256(concat(${fields.join(", ")}))))`;
}

function updateNamedField(hash: Hash, name: string, value: string): void {
	updateFramedField(hash, name);
	updateFramedField(hash, value);
}

function updateNamedNullableField(
	hash: Hash,
	name: string,
	value: string | null | undefined,
): void {
	updateFramedField(hash, name);
	if (value === null || value === undefined) {
		updateFramedField(hash, "absent");
		return;
	}
	updateFramedField(hash, "present");
	updateFramedField(hash, value);
}

function updateFramedField(hash: Hash, field: string): void {
	hash.update(`${Buffer.byteLength(field, "utf8")}:`);
	hash.update(field, "utf8");
}

function framedConstant(value: string): string {
	return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function framedSql(expression: string): string {
	return `concat(toString(length(${expression})), ':', ${expression})`;
}

function namedSqlField(name: string, expression: string): string {
	return `concat(${sqlLiteral(framedConstant(name))}, ${framedSql(expression)})`;
}

function namedNullableSqlField(name: string, expression: string): string {
	return `concat(${sqlLiteral(framedConstant(name))}, if(isNull(${expression}), ${sqlLiteral(framedConstant("absent"))}, concat(${sqlLiteral(framedConstant("present"))}, ${framedSql(`ifNull(${expression}, '')`)})))`;
}

function sqlLiteral(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
