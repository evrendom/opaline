import { expect, test } from "bun:test";
import { contract } from "@rudel/api-routes";
import { DEMO_INPUT_RULES } from "./demo-input-rules";

interface SchemaNode {
	_zod: {
		def: {
			type: string;
			shape?: Record<string, unknown>;
			options?: readonly SchemaNode[];
			in?: SchemaNode;
		};
	};
}

/** The fields a procedure's input can carry: an object's, or any union member's. */
function inputFields(schema: SchemaNode | undefined): string[] {
	if (!schema) return [];
	const { def } = schema._zod;
	if (def.type === "object") return Object.keys(def.shape ?? {});
	if (def.type === "union")
		return [...new Set((def.options ?? []).flatMap(inputFields))];
	if (def.type === "pipe") return inputFields(def.in);
	throw new Error(`An input of type ${def.type}`);
}

function procedure(path: string): { inputSchema?: SchemaNode } {
	let node: unknown = contract;
	for (const part of path.slice("/rpc/".length).split("/"))
		node = (node as Record<string, unknown> | undefined)?.[part];
	const definition = (node as { "~orpc"?: { inputSchema?: SchemaNode } })?.[
		"~orpc"
	];
	if (!definition) throw new Error(`${path} is not in the contract`);
	return definition;
}

test("every RPC path's rules sort exactly the contract's inputs", () => {
	const unsorted: Record<string, unknown> = {};
	for (const [path, rules] of Object.entries(DEMO_INPUT_RULES)) {
		if (!path.startsWith("/rpc/")) continue;
		const fields = inputFields(procedure(path).inputSchema).sort();
		const identity = [...rules.identity];
		const presentation = [...(rules.presentation ?? [])];
		const sorted = [...identity, ...presentation].sort();
		const defaulted = Object.keys(rules.defaults ?? {}).filter(
			(field) => !identity.includes(field),
		);
		if (
			JSON.stringify(sorted) !== JSON.stringify(fields) ||
			defaulted.length > 0
		)
			unsorted[path] = { fields, identity, presentation, defaulted };
	}
	expect(unsorted).toEqual({});
});
