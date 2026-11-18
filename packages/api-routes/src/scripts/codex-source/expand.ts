import type { HistoryModes, PersistenceDecision } from "./persistence.js";
import type {
	Attributes,
	RustDefinition,
	RustField,
	RustIndex,
	RustType,
	RustVariant,
} from "./rust-source.js";
import { parseRustType, tokenizeRust } from "./rust-source.js";

export interface SourcePath {
	readonly path: string;
	readonly type: string;
	readonly source: string;
	readonly modes: Exclude<HistoryModes, "none">;
	readonly policy: number;
	readonly scope?: "opaque" | "decoded_arguments" | "unknown";
}

export interface SourceSnapshot {
	readonly version: string;
	readonly tag: string;
	readonly commit: string;
	readonly policies: readonly PersistenceDecision[];
	readonly paths: readonly SourcePath[];
	readonly diagnostics: readonly string[];
}

const STRING_TYPES = new Set([
	"String",
	"str",
	"char",
	"PathBuf",
	"Path",
	"AbsolutePathBuf",
	"ThreadId",
	"SessionId",
	"Uuid",
	"DateTime",
	"PathUri",
	"LegacyAppPathString",
	"ReasoningEffort",
	"OsString",
	"Url",
	"Utc",
	"RelativePathBuf",
	"NaiveDateTime",
	"ResponseItemId",
	"TurnId",
	"AgentPath",
]);
const TRANSPARENT = new Set([
	"Box",
	"Arc",
	"Rc",
	"Cow",
	"RefCell",
	"Cell",
	"Mutex",
	"RwLock",
	"Pin",
	"ManuallyDrop",
	"Option",
]);
const SEQUENCE = new Set([
	"Vec",
	"VecDeque",
	"HashSet",
	"BTreeSet",
	"IndexSet",
	"BinaryHeap",
	"LinkedList",
]);
const MAP = new Set(["HashMap", "BTreeMap", "IndexMap"]);
const OPAQUE_KEYS = new Set([
	"input_schema",
	"inputSchema",
	"outputSchema",
	"output_schema",
	"parameters",
	"schema",
	"structuredContent",
	"_meta",
]);
const DYNAMIC_KEYS = new Set([
	"changes",
	"env",
	"headers",
	"mcp_servers",
	"mcpServers",
	"modelUsage",
	"wireToolInputs",
	"properties",
	"definitions",
	"$defs",
	"patternProperties",
]);
const SERIALIZER_ADAPTERS: Readonly<
	Record<string, { wire: string; required: readonly string[] }>
> = {
	RolloutItem: { wire: "RolloutItemWire", required: ["RolloutItemWire"] },
	CompactedItem: { wire: "CompactedItemWire", required: ["CompactedItemWire"] },
	CodexErrorInfo: {
		wire: "CodexErrorInfoWire",
		required: ["CodexErrorInfoWire"],
	},
	FileSystemPermissions: {
		wire: "FileSystemPermissionsDe",
		required: ["as_legacy_permissions", "CanonicalFileSystemPermissions"],
	},
	ManagedFileSystemPermissions: {
		wire: "SerializedManagedFileSystemPermissions",
		required: ["SerializedManagedFileSystemPermissions"],
	},
	FunctionCallOutputPayload: {
		wire: "FunctionCallOutputBody",
		required: [
			"FunctionCallOutputBody :: Text",
			"FunctionCallOutputBody :: ContentItems",
			"serialize_str",
		],
	},
};

export function serdeAttr(attrs: Attributes, key: string): string | undefined {
	const value = attrs[key];
	return typeof value === "string"
		? value
		: typeof value === "object" && typeof value.serialize === "string"
			? value.serialize
			: undefined;
}

export function serdeName(
	name: string,
	attrs: Attributes,
	rule: string | undefined,
	variant = false,
): string {
	const rename = serdeAttr(attrs, "rename");
	if (rename !== undefined) return rename;
	if (rule === undefined) return name;
	const words = variant
		? (name.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/gu) ?? [name])
		: name.split("_");
	switch (rule) {
		case "lowercase":
			return variant ? name.toLowerCase() : name;
		case "UPPERCASE":
			return name.toUpperCase();
		case "PascalCase":
			return variant
				? name
				: words
						.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
						.join("");
		case "camelCase":
			return variant
				? name.slice(0, 1).toLowerCase() + name.slice(1)
				: (words[0] ?? "") +
						words
							.slice(1)
							.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
							.join("");
		case "snake_case":
			return variant ? words.join("_").toLowerCase() : name;
		case "SCREAMING_SNAKE_CASE":
			return words.join("_").toUpperCase();
		case "kebab-case":
			return words.join("-").toLowerCase();
		case "SCREAMING-KEBAB-CASE":
			return words.join("-").toUpperCase();
		default:
			throw new Error(`Unsupported serde rename_all ${rule}`);
	}
}

export function sourceReference(
	definition: RustDefinition,
	line = definition.line,
): string {
	return `codex-rs/${definition.file}:${line}`;
}

interface Expansion {
	readonly path: string;
	readonly key: string;
	readonly file: string;
	readonly source: string;
	readonly stack: readonly string[];
	readonly env: ReadonlyMap<string, RustType>;
	readonly flattened?: boolean;
}

interface MutablePath {
	path: string;
	types: Set<string>;
	source: string;
	modes: Exclude<HistoryModes, "none">;
	policy: number;
	scope: SourcePath["scope"];
}

export class SourceExpander {
	readonly paths = new Map<string, MutablePath>();
	readonly policies: PersistenceDecision[] = [];
	readonly diagnostics = new Set<string>();
	readonly heads = new Set<string>();
	policy = 0;
	modes: Exclude<HistoryModes, "none"> = "both";
	argumentScope = false;

	constructor(readonly index: RustIndex) {}

	setPolicy(decision: PersistenceDecision): void {
		if (decision.modes === "none")
			throw new Error("Expanding a non-persisted variant");
		let position = this.policies.findIndex(
			(policy) =>
				policy.file === decision.file &&
				policy.line === decision.line &&
				policy.decision === decision.decision,
		);
		if (position < 0) {
			position = this.policies.length;
			this.policies.push(decision);
		}
		this.policy = position;
		this.modes = decision.modes;
	}

	emit(
		path: string,
		type: string,
		source: string,
		scope?: SourcePath["scope"],
	): void {
		const existing = this.paths.get(path);
		if (existing !== undefined) {
			existing.types.add(type);
			if (existing.modes !== this.modes) existing.modes = "both";
			if (scope !== undefined) existing.scope = scope;
		} else
			this.paths.set(path, {
				path,
				types: new Set([type]),
				source,
				policy: this.policy,
				modes: this.modes,
				scope: scope ?? (this.argumentScope ? "decoded_arguments" : undefined),
			});
	}

	private unknown(context: Expansion, why: string): void {
		this.diagnostics.add(`${context.source}: ${why}`);
		this.emit(context.path, "unknown", context.source, "unknown");
	}

	private adapted(definition: RustDefinition): RustDefinition | undefined {
		const serializers = [...this.index.files.values()]
			.filter((file) =>
				file.definitions.some((item) => item.crate === definition.crate),
			)
			.flatMap((file) => {
				const serializer = file.serializers.get(definition.name);
				return serializer === undefined ? [] : [serializer];
			});
		if (serializers.length > 1)
			throw new Error(`Ambiguous serializer ${sourceReference(definition)}`);
		const serializer = serializers[0];
		const adapter = SERIALIZER_ADAPTERS[definition.name];
		if (serializer === undefined) return definition;
		if (adapter === undefined) return undefined;
		if (
			adapter.required.some((required) => !serializer.body.includes(required))
		)
			throw new Error(
				`Changed serializer ${sourceReference(definition, serializer.line)}; review adapter`,
			);
		const wire = this.index.resolve(
			{ kind: "path", segments: [adapter.wire], args: [] },
			definition.file,
		);
		if (wire === undefined)
			throw new Error(`Missing serialization wire ${adapter.wire}`);
		return wire;
	}

	peel(
		type: RustType,
		file: string,
		env: ReadonlyMap<string, RustType> = new Map(),
	):
		| { definition: RustDefinition; env: ReadonlyMap<string, RustType> }
		| undefined {
		for (let depth = 0; depth < 16; depth++) {
			if (type.kind !== "path") return undefined;
			const name = type.segments.at(-1) ?? "";
			const argument = type.args[0];
			const bound = env.get(name);
			if (bound !== undefined) {
				type = bound;
				continue;
			}
			if (TRANSPARENT.has(name) && argument !== undefined) {
				type = argument;
				continue;
			}
			const found = this.index.resolve(type, file);
			if (found === undefined) return undefined;
			const definition = this.adapted(found);
			if (definition === undefined) return undefined;
			env = this.bind(definition, type.args, env);
			if (definition.kind === "type" && definition.alias !== undefined) {
				type = definition.alias;
				file = definition.file;
				continue;
			}
			return { definition, env };
		}
		return undefined;
	}

	private bind(
		definition: RustDefinition,
		args: readonly RustType[],
		outer: ReadonlyMap<string, RustType>,
	): ReadonlyMap<string, RustType> {
		const env = new Map(outer);
		definition.generics.forEach((name, position) => {
			const argument = args[position];
			if (argument !== undefined)
				env.set(
					name,
					argument.kind === "path" && argument.segments.length === 1
						? (outer.get(argument.segments[0] ?? "") ?? argument)
						: argument,
				);
		});
		return env;
	}

	expand(type: RustType, context: Expansion): void {
		if (context.stack.length > 24) {
			this.unknown(context, "recursion depth limit");
			return;
		}
		if (type.kind === "unknown") {
			this.unknown(context, `unsupported type ${type.text}`);
			return;
		}
		if (type.kind === "tuple") {
			if (type.elements.length === 0)
				this.emit(context.path, "null", context.source);
			else if (type.elements.length === 1) {
				const element = type.elements[0];
				if (element === undefined) throw new Error("Missing tuple element");
				this.expand(element, context);
			} else {
				this.emit(context.path, "array", context.source);
				for (const element of type.elements)
					this.expand(element, { ...context, path: `${context.path}[]` });
			}
			return;
		}
		if (type.kind === "sequence") {
			this.sequence(type.element, context);
			return;
		}
		const name = type.segments.at(-1) ?? "";
		const bound = context.env.get(name);
		if (bound !== undefined && type.segments.length === 1) {
			this.expand(bound, context);
			return;
		}
		const argument = type.args[0];
		if (
			(TRANSPARENT.has(name) || name === "Result") &&
			argument !== undefined
		) {
			this.expand(argument, context);
			if (name === "Option") this.emit(context.path, "null", context.source);
			return;
		}
		if (SEQUENCE.has(name) && argument !== undefined) {
			this.sequence(argument, context);
			return;
		}
		const mapValue = type.args[1];
		if (MAP.has(name) && mapValue !== undefined) {
			this.emit(context.path, "object", context.source);
			this.expand(mapValue, {
				...context,
				path: `${context.path}.{*}`,
				key: "{*}",
			});
			return;
		}
		if (
			["Value", "JsonValue", "Map"].includes(name) &&
			(type.segments.length === 1 || type.segments.includes("serde_json"))
		) {
			this.emit(context.path, "any", context.source, "opaque");
			return;
		}
		if (name === "Duration") {
			this.emit(`${context.path}.secs`, "number", context.source);
			this.emit(`${context.path}.nanos`, "number", context.source);
			return;
		}
		if (name === "GuardianHistoryCheckpoint") {
			this.emit(context.path, "array", context.source);
			this.expand(
				{ kind: "path", segments: ["Entry"], args: [] },
				{
					...context,
					path: `${context.path}[]`,
					file: "history/src/guardian_history.rs",
				},
			);
			return;
		}
		if (STRING_TYPES.has(name)) {
			this.emit(context.path, "string", context.source);
			return;
		}
		if (name === "bool") {
			this.emit(context.path, "boolean", context.source);
			return;
		}
		if (
			/^(?:[ui](?:8|16|32|64|128|size)|f(?:32|64)|NonZero(?:U|I)(?:8|16|32|64|size)|Decimal|Number)$/u.test(
				name,
			)
		) {
			this.emit(context.path, "number", context.source);
			return;
		}
		if (name === "PhantomData") return;
		const found = this.index.resolve(type, context.file);
		if (found === undefined) {
			this.unknown(context, `unresolved or ambiguous type ${name}`);
			return;
		}
		if (STRING_TYPES.has(found.name)) {
			this.emit(context.path, "string", context.source);
			return;
		}
		const into = serdeAttr(found.attrs, "into");
		if (into !== undefined) {
			this.expand(parseRustType(tokenizeRust(into)), {
				...context,
				file: found.file,
			});
			return;
		}
		const definition = this.adapted(found);
		if (definition === undefined) {
			this.unknown(
				context,
				`manual serializer ${name} has no reviewed adapter`,
			);
			return;
		}
		const env = this.bind(definition, type.args, context.env);
		if (definition.kind === "type" && definition.alias !== undefined) {
			this.expand(definition.alias, { ...context, file: definition.file, env });
			return;
		}
		if (context.stack.includes(`${definition.file}:${definition.name}`)) {
			this.unknown(context, `recursive type ${name}`);
			return;
		}
		const next = {
			...context,
			file: definition.file,
			stack: [...context.stack, `${definition.file}:${definition.name}`],
			env,
		};
		if (definition.kind === "struct") this.struct(definition, next);
		else this.enumeration(definition, next);
	}

	private sequence(element: RustType, context: Expansion): void {
		this.emit(context.path, "array", context.source);
		const resolved = this.peel(element, context.file, context.env);
		if (
			["content", "output", "content_items"].includes(context.key) &&
			resolved?.definition.kind === "enum" &&
			serdeAttr(resolved.definition.attrs, "tag") === "type" &&
			!resolved.definition.attrs.untagged
		) {
			for (const variant of resolved.definition.variants) {
				if (
					variant.attrs.skip ||
					variant.attrs.skip_serializing ||
					variant.attrs.other
				)
					continue;
				const name = serdeName(
					variant.name,
					variant.attrs,
					serdeAttr(resolved.definition.attrs, "rename_all"),
					true,
				);
				this.variant(
					resolved.definition,
					variant,
					{
						...context,
						path: `${context.path}[${name}]`,
						file: resolved.definition.file,
						env: resolved.env,
					},
					"type",
				);
			}
		} else this.expand(element, { ...context, path: `${context.path}[]` });
	}

	fields(
		definition: RustDefinition,
		fields: readonly RustField[],
		context: Expansion,
		rule = serdeAttr(
			definition.attrs,
			definition.kind === "enum" ? "rename_all_fields" : "rename_all",
		),
		skipTag?: string,
	): void {
		for (const field of fields) {
			if (
				field.name === undefined ||
				field.attrs.skip ||
				field.attrs.skip_serializing
			)
				continue;
			const source = sourceReference(definition, field.line);
			if (field.attrs.flatten) {
				this.expand(field.type, {
					...context,
					file: definition.file,
					source,
					flattened: true,
				});
				continue;
			}
			const name = serdeName(field.name, field.attrs, rule);
			if (name === skipTag) continue;
			const dynamic =
				!this.heads.has(context.path) &&
				(DYNAMIC_KEYS.has(context.key) ||
					/^(?:toolu_|srvtoolu_|call_|ws_|fc_|rs_|msg_)/u.test(name));
			const path = `${context.path}.${dynamic ? "{*}" : name}`;
			if (OPAQUE_KEYS.has(name)) {
				this.emit(path, "any", source, "opaque");
				continue;
			}
			if (field.attrs.serialize_with || field.attrs.with) {
				this.unknown(
					{ ...context, path, source },
					`custom field serializer ${definition.name}.${field.name}`,
				);
				continue;
			}
			const type =
				field.attrs.skip_serializing_if &&
				field.type.kind === "path" &&
				field.type.segments.at(-1) === "Option"
					? (field.type.args[0] ?? field.type)
					: field.type;
			this.expand(type, {
				...context,
				path,
				key: name,
				file: definition.file,
				source,
				flattened: false,
			});
		}
	}

	struct(definition: RustDefinition, context: Expansion): void {
		if (
			(definition.shape === "tuple" && definition.fields.length === 1) ||
			definition.attrs.transparent
		) {
			const first = definition.fields[0];
			if (first === undefined)
				throw new Error(`Empty transparent struct ${definition.name}`);
			this.expand(first.type, { ...context, file: definition.file });
		} else if (definition.shape === "tuple") {
			this.emit(context.path, "array", context.source);
			for (const field of definition.fields)
				this.expand(field.type, {
					...context,
					path: `${context.path}[]`,
					source: sourceReference(definition, field.line),
					file: definition.file,
				});
		} else {
			const before = this.paths.size;
			this.fields(definition, definition.fields, context);
			if (before === this.paths.size && !context.flattened)
				this.emit(context.path, "object", sourceReference(definition));
		}
	}

	variant(
		definition: RustDefinition,
		variant: RustVariant,
		context: Expansion,
		skipTag?: string,
	): void {
		const rule =
			serdeAttr(variant.attrs, "rename_all") ??
			serdeAttr(definition.attrs, "rename_all_fields");
		if (variant.shape === "named")
			this.fields(definition, variant.fields, context, rule, skipTag);
		else if (variant.shape === "tuple" && variant.fields.length === 1) {
			const first = variant.fields[0];
			if (first === undefined) throw new Error("Missing variant field");
			const resolved = this.peel(first.type, definition.file, context.env);
			if (
				serdeAttr(definition.attrs, "tag") !== undefined &&
				resolved?.definition.kind === "struct" &&
				resolved.definition.shape === "named"
			)
				this.fields(
					resolved.definition,
					resolved.definition.fields,
					{ ...context, env: resolved.env, file: resolved.definition.file },
					serdeAttr(resolved.definition.attrs, "rename_all"),
					skipTag,
				);
			else
				this.expand(first.type, {
					...context,
					file: definition.file,
					source: sourceReference(definition, first.line),
					flattened: true,
				});
		} else if (variant.shape === "tuple") {
			this.emit(
				context.path,
				"array",
				sourceReference(definition, variant.line),
			);
			for (const field of variant.fields)
				this.expand(field.type, {
					...context,
					path: `${context.path}[]`,
					file: definition.file,
					source: sourceReference(definition, field.line),
				});
		} else if (definition.attrs.untagged)
			this.emit(
				context.path,
				"null",
				sourceReference(definition, variant.line),
			);
	}

	private enumeration(definition: RustDefinition, context: Expansion): void {
		const tag = serdeAttr(definition.attrs, "tag");
		const content = serdeAttr(definition.attrs, "content");
		for (const variant of definition.variants) {
			if (variant.attrs.skip || variant.attrs.skip_serializing) continue;
			const savedPolicy = this.policies[this.policy];
			if (
				definition.name === "ExtensionItem" &&
				context.path.startsWith("event_msg/item_completed:Extension") &&
				savedPolicy !== undefined &&
				variant.name !== "Sleep"
			) {
				this.setPolicy({
					...savedPolicy,
					modes: "paginated",
					decision: `${savedPolicy.decision} ExtensionItem::${variant.name} is not Sleep, so Legacy does not persist it.`,
				});
			}
			const name = serdeName(
				variant.name,
				variant.attrs,
				serdeAttr(definition.attrs, "rename_all"),
				true,
			);
			if (definition.attrs.untagged) this.variant(definition, variant, context);
			else if (tag !== undefined) {
				this.emit(
					`${context.path}.${tag}`,
					"string",
					sourceReference(definition, variant.line),
				);
				this.variant(
					definition,
					variant,
					{
						...context,
						path:
							content === undefined
								? context.path
								: `${context.path}.${content}`,
					},
					tag,
				);
			} else if (variant.shape === "unit")
				this.emit(
					context.path,
					"string",
					sourceReference(definition, variant.line),
				);
			else
				this.variant(definition, variant, {
					...context,
					path: `${context.path}.${name}`,
					key: name,
				});
			if (savedPolicy !== undefined) this.setPolicy(savedPolicy);
		}
	}

	result(): SourcePath[] {
		return [...this.paths.values()]
			.sort((left, right) => left.path.localeCompare(right.path))
			.map((entry) => ({
				path: entry.path,
				type: [...entry.types].sort().join("|"),
				source: entry.source,
				modes: entry.modes,
				policy: entry.policy,
				...(entry.scope === undefined ? {} : { scope: entry.scope }),
			}));
	}
}

export function expansionAt(
	path: string,
	definition: RustDefinition,
): Expansion {
	return {
		path,
		key: "",
		file: definition.file,
		source: sourceReference(definition),
		stack: [],
		env: new Map(),
	};
}
