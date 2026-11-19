import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	expansionAt,
	SourceExpander,
	type SourceSnapshot,
	serdeAttr,
	serdeName,
	sourceReference,
} from "./expand.js";
import {
	completedItemPolicy,
	type PersistenceDecision,
	persistenceMatch,
} from "./persistence.js";
import {
	groupEnd,
	parseRustType,
	type RustDefinition,
	RustIndex,
	tokenizeRust,
} from "./rust-source.js";

export function generateSourceSnapshot(
	root: string,
	version: string,
	commit: string,
): SourceSnapshot {
	const index = new RustIndex();
	index.load(root);
	const policyText = readFileSync(join(root, "rollout/src/policy.rs"), "utf8");
	const rollout = persistenceMatch(
		policyText,
		"persisted_rollout_item",
		"RolloutItem",
	);
	const events = persistenceMatch(
		policyText,
		"persisted_event_msg",
		"EventMsg",
	);
	const responses = persistenceMatch(
		policyText,
		"should_persist_response_item",
		"ResponseItem",
	);
	const required = (name: string, file: string): RustDefinition => {
		const definition = index.resolve(
			{ kind: "path", segments: [name], args: [] },
			file,
		);
		if (definition === undefined)
			throw new Error(`Missing or ambiguous root type ${name}`);
		return definition;
	};
	const wire = required("RolloutItemWire", "history/src/rollout_payload.rs");
	const line = required("RolloutLine", "history/src/lib.rs");
	const expander = new SourceExpander(index);
	const envelope = (
		head: string,
		policy: PersistenceDecision,
		metadata: (typeof wire.fields)[number] | undefined,
	) => {
		expander.setPolicy(policy);
		for (const field of line.fields) {
			if (field.name === "timestamp" || field.name === "ordinal")
				expander.expand(field.type, {
					...expansionAt(`${head}@${field.name}`, line),
					source: sourceReference(line, field.line),
				});
		}
		if (metadata !== undefined)
			expander.expand(metadata.type, {
				...expansionAt(`${head}@metadata`, wire),
				key: "metadata",
				source: sourceReference(wire, metadata.line),
			});
	};
	for (const variant of wire.variants) {
		const kind = serdeName(
			variant.name,
			variant.attrs,
			serdeAttr(wire.attrs, "rename_all"),
			true,
		);
		const rootPolicy = rollout.get(variant.name);
		if (rootPolicy === undefined)
			throw new Error(`RolloutItem::${variant.name} has no policy decision`);
		if (rootPolicy.modes === "none") continue;
		const payload = variant.fields.find((field) => field.name === "payload");
		if (payload === undefined) throw new Error(`Missing payload for ${kind}`);
		const metadata = variant.fields.find((field) => field.name === "metadata");
		const resolved = expander.peel(payload.type, wire.file);
		if (resolved === undefined)
			throw new Error(`Cannot resolve payload for ${kind}`);
		const definition = resolved.definition;
		if (
			definition.kind === "enum" &&
			serdeAttr(definition.attrs, "tag") === "type" &&
			!definition.attrs.untagged
		) {
			for (const item of definition.variants) {
				if (item.attrs.skip || item.attrs.skip_serializing) continue;
				const itemPolicy =
					kind === "event_msg"
						? events.get(item.name)
						: kind === "response_item"
							? responses.get(item.name)
							: rootPolicy;
				if (itemPolicy === undefined)
					throw new Error(`Missing policy for ${kind}/${item.name}`);
				if (itemPolicy.modes === "none") continue;
				const name = serdeName(
					item.name,
					item.attrs,
					serdeAttr(definition.attrs, "rename_all"),
					true,
				);
				const discriminator =
					kind === "response_item" &&
					["function_call", "custom_tool_call", "message"].includes(name)
						? ":*"
						: "";
				const head = `${kind}/${name}${discriminator}`;
				expander.heads.add(head);
				expander.setPolicy(itemPolicy);
				if (kind === "event_msg" && item.name === "ItemCompleted") {
					const eventType = item.fields[0]?.type;
					const event =
						eventType === undefined
							? undefined
							: expander.peel(eventType, definition.file, resolved.env);
					if (event === undefined)
						throw new Error("Missing ItemCompletedEvent");
					for (const field of event.definition.fields) {
						if (field.name !== "item") {
							expander.setPolicy(itemPolicy);
							expander.fields(event.definition, [field], {
								...expansionAt(head, event.definition),
								env: event.env,
							});
							continue;
						}
						const turnItem = expander.peel(
							field.type,
							event.definition.file,
							event.env,
						);
						if (turnItem === undefined) throw new Error("Missing TurnItem");
						for (const completed of turnItem.definition.variants) {
							if (completed.attrs.skip || completed.attrs.skip_serializing)
								continue;
							const completedHead = `${head}:${serdeName(completed.name, completed.attrs, serdeAttr(turnItem.definition.attrs, "rename_all"), true)}`;
							expander.heads.add(completedHead);
							expander.setPolicy(
								completedItemPolicy(policyText, completed.name),
							);
							expander.variant(
								turnItem.definition,
								completed,
								{
									...expansionAt(completedHead, turnItem.definition),
									env: turnItem.env,
								},
								"type",
							);
						}
					}
				} else {
					const before = expander.paths.size;
					expander.variant(
						definition,
						item,
						{ ...expansionAt(head, definition), env: resolved.env },
						"type",
					);
					if (before === expander.paths.size)
						expander.emit(
							head,
							"object",
							sourceReference(definition, item.line),
						);
				}
				envelope(head, itemPolicy, metadata);
			}
		} else {
			const head = `${kind}/`;
			expander.heads.add(head);
			expander.setPolicy(rootPolicy);
			expander.expand(payload.type, {
				...expansionAt(head, wire),
				source: sourceReference(wire, payload.line),
				flattened: true,
			});
			envelope(head, rootPolicy, metadata);
		}
	}
	const worldPolicy = rollout.get("WorldState");
	if (worldPolicy === undefined) throw new Error("Missing WorldState policy");
	expander.setPolicy(worldPolicy);
	for (const file of index.files.keys()) {
		if (!file.startsWith("core/src/context/")) continue;
		const tokens = tokenizeRust(readFileSync(join(root, file), "utf8"));
		for (let position = 0; position < tokens.length; position++) {
			if (
				tokens[position]?.text !== "impl" ||
				tokens[position + 1]?.text !== "WorldStateSection" ||
				tokens[position + 2]?.text !== "for"
			)
				continue;
			const owner = tokens[position + 3]?.text;
			const opening = position + 4;
			if (tokens[opening]?.text !== "{")
				throw new Error(`Unsupported WorldStateSection impl in ${file}`);
			const body = tokens.slice(opening + 1, groupEnd(tokens, opening) - 1);
			const id = body.findIndex(
				(token, cursor) =>
					token.text === "ID" && body[cursor - 1]?.text === "const",
			);
			const section = body
				.slice(id + 1)
				.find((token) => token.kind === "string")?.text;
			const alias = body.findIndex(
				(token, cursor) =>
					token.text === "Snapshot" && body[cursor - 1]?.text === "type",
			);
			const end = body.findIndex(
				(token, cursor) => cursor > alias && token.text === ";",
			);
			if (
				id < 0 ||
				section === undefined ||
				alias < 0 ||
				end < 0 ||
				owner === undefined
			)
				throw new Error(`Missing WorldStateSection ID/Snapshot in ${file}`);
			const type = parseRustType(
				body
					.slice(alias + 2, end)
					.map((token) =>
						token.text === "Self" ? { ...token, text: owner } : token,
					),
			);
			const path = `world_state/.state.${section}`;
			const source = `codex-rs/${file}:${body[alias]?.line}`;
			expander.expand(type, {
				path,
				key: section,
				file,
				source,
				stack: [],
				env: new Map(),
			});
			expander.emit(path, "null", source);
			position = groupEnd(tokens, opening) - 1;
		}
	}
	const argumentsPolicy = responses.get("FunctionCall");
	if (argumentsPolicy === undefined)
		throw new Error("Missing function call policy");
	expander.setPolicy(argumentsPolicy);
	expander.argumentScope = true;
	const tools: Readonly<Record<string, readonly string[]>> = {
		exec_command: ["ExecCommandArgs", "ExecCommandEnvironmentArgs"],
		write_stdin: ["WriteStdinArgs"],
		update_plan: ["UpdatePlanArgs"],
		view_image: ["ViewImageArgs"],
		spawn_agent: ["SpawnAgentArgs"],
		request_user_input: ["RequestUserInputArgs"],
	};
	for (const [tool, types] of Object.entries(tools)) {
		let found = false;
		for (const type of types)
			for (const definition of index.definitions.get(type) ?? []) {
				if (
					!definition.file.startsWith("core/src/tools/") &&
					!definition.file.startsWith("protocol/")
				)
					continue;
				found = true;
				expander.struct(
					definition,
					expansionAt(
						`response_item/function_call:${tool}.arguments`,
						definition,
					),
				);
			}
		if (!found)
			expander.diagnostics.add(
				`No decoded argument declaration for ${tool}; review tool registration for this tag`,
			);
	}
	return {
		version,
		tag: `rust-v${version}`,
		commit,
		policies: expander.policies,
		paths: expander.result(),
		diagnostics: [...expander.diagnostics].sort(),
	};
}
