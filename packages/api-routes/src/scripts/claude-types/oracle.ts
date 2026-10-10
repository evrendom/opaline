import { createHash } from "node:crypto";
import ts from "typescript";

export interface ClaudeTypePath {
	readonly tool: string;
	readonly schema: string;
	readonly direction: "input" | "result";
	readonly path: string;
	readonly source: string;
	readonly type: string;
	readonly optional: boolean;
	readonly comment: string;
	readonly opaque: boolean;
}

export interface ClaudeTypesSnapshot {
	readonly version: string;
	readonly claudeCodeVersion: string;
	readonly sha256: string;
	readonly tools: readonly string[];
	readonly paths: readonly ClaudeTypePath[];
	readonly diagnostics: readonly string[];
}

const TOOL_NAMES: Readonly<Record<string, string>> = {
	FileEdit: "Edit",
	FileRead: "Read",
	FileWrite: "Write",
	ListMcpResources: "ListMcpResources",
	RefreshMcpTools: "RefreshMcpTools",
	Mcp: "mcp__{*}",
	ReadMcpResourceDir: "ReadMcpResourceDir",
	ReadMcpResource: "ReadMcpResource",
};

export function generateClaudeTypesSnapshot(
	text: string,
	version: string,
	claudeCodeVersion: string,
): ClaudeTypesSnapshot {
	const source = ts.createSourceFile(
		"sdk-tools.d.ts",
		text,
		ts.ScriptTarget.Latest,
		true,
	);
	const definitions = new Map<
		string,
		ts.InterfaceDeclaration | ts.TypeAliasDeclaration
	>();
	for (const statement of source.statements)
		if (
			ts.isInterfaceDeclaration(statement) ||
			ts.isTypeAliasDeclaration(statement)
		)
			definitions.set(statement.name.text, statement);
	const paths = new Map<string, ClaudeTypePath>();
	const diagnostics = new Set<string>();
	const line = (node: ts.Node) =>
		source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const comment = (node: ts.Node): string =>
		ts
			.getJSDocCommentsAndTags(node)
			.filter(ts.isJSDoc)
			.map((doc) =>
				typeof doc.comment === "string"
					? doc.comment
					: (doc.comment?.map((part) => part.getText(source)).join("") ?? ""),
			)
			.join(" ")
			.replace(/\s+/gu, " ")
			.trim();
	const emit = (
		context: Omit<ClaudeTypePath, "type" | "opaque">,
		type: string,
		opaque = false,
	) => {
		const entry = { ...context, type, opaque };
		paths.set(
			`${entry.tool}:${entry.direction}:${entry.path}:${entry.type}:${entry.source}`,
			entry,
		);
	};
	const members = (
		fields: ts.NodeArray<ts.TypeElement>,
		context: Omit<ClaudeTypePath, "type" | "opaque">,
		stack: readonly string[],
		skipType = false,
	) => {
		for (const member of fields) {
			if (ts.isPropertySignature(member) && member.type !== undefined) {
				const name =
					ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
						? member.name.text
						: member.name.getText(source);
				if (skipType && name === "type") continue;
				expand(
					member.type,
					{
						...context,
						path: `${context.path}.${name}`,
						source: `sdk-tools.d.ts:${line(member)}`,
						optional: context.optional || member.questionToken !== undefined,
						comment: comment(member),
					},
					stack,
				);
			} else if (
				ts.isIndexSignatureDeclaration(member) &&
				member.type !== undefined
			)
				expand(
					member.type,
					{
						...context,
						path: `${context.path}.{*}`,
						source: `sdk-tools.d.ts:${line(member)}`,
					},
					stack,
				);
			else diagnostics.add(`Unsupported member sdk-tools.d.ts:${line(member)}`);
		}
	};
	const array = (
		element: ts.TypeNode,
		context: Omit<ClaudeTypePath, "type" | "opaque">,
		stack: readonly string[],
	) => {
		emit(context, "array");
		let item = element;
		while (ts.isParenthesizedTypeNode(item)) item = item.type;
		const variants = ts.isUnionTypeNode(item) ? item.types : [item];
		for (const variant of variants) {
			const discriminator = ts.isTypeLiteralNode(variant)
				? variant.members.find(
						(member) =>
							ts.isPropertySignature(member) &&
							member.name.getText(source) === "type",
					)
				: undefined;
			const block =
				discriminator !== undefined &&
				ts.isPropertySignature(discriminator) &&
				discriminator.type !== undefined &&
				ts.isLiteralTypeNode(discriminator.type) &&
				ts.isStringLiteral(discriminator.type.literal) &&
				/\.(?:content|output|content_items)$/u.test(context.path)
					? discriminator.type.literal.text
					: undefined;
			const child = {
				...context,
				path: `${context.path}${block === undefined ? "[]" : `[${block}]`}`,
			};
			if (block !== undefined && ts.isTypeLiteralNode(variant))
				members(variant.members, child, stack, true);
			else expand(variant, child, stack);
		}
	};
	const expand = (
		type: ts.TypeNode,
		context: Omit<ClaudeTypePath, "type" | "opaque">,
		stack: readonly string[],
	): void => {
		if (ts.isParenthesizedTypeNode(type)) expand(type.type, context, stack);
		else if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type))
			for (const variant of type.types) expand(variant, context, stack);
		else if (ts.isArrayTypeNode(type)) array(type.elementType, context, stack);
		else if (ts.isTypeLiteralNode(type)) {
			emit(context, "object");
			members(type.members, context, stack);
		} else if (ts.isTypeReferenceNode(type)) {
			const name = type.typeName.getText(source);
			const definition = definitions.get(name);
			if (
				(name === "Array" || name === "ReadonlyArray") &&
				type.typeArguments?.[0] !== undefined
			)
				array(type.typeArguments[0], context, stack);
			else if (name === "Record" && type.typeArguments?.[1] !== undefined)
				expand(
					type.typeArguments[1],
					{ ...context, path: `${context.path}.{*}` },
					stack,
				);
			else if (definition === undefined || stack.includes(name)) {
				emit(context, name, true);
				diagnostics.add(`Unresolved or recursive ${name} at ${context.source}`);
			} else if (ts.isTypeAliasDeclaration(definition))
				expand(definition.type, context, [...stack, name]);
			else {
				emit(context, "object");
				members(definition.members, context, [...stack, name]);
			}
		} else
			emit(
				context,
				type.getText(source),
				type.kind === ts.SyntaxKind.UnknownKeyword ||
					type.kind === ts.SyntaxKind.AnyKeyword,
			);
	};
	const schemas = (name: string) => {
		const definition = definitions.get(name);
		if (definition === undefined || !ts.isTypeAliasDeclaration(definition))
			throw new Error(`Missing ${name}`);
		const variants: readonly ts.TypeNode[] = ts.isUnionTypeNode(definition.type)
			? definition.type.types
			: [definition.type];
		return variants.flatMap((type) =>
			ts.isTypeReferenceNode(type) ? [type.typeName.getText(source)] : [],
		);
	};
	const tools = new Set<string>();
	for (const [direction, union, suffix] of [
		["input", "ToolInputSchemas", "Input"],
		["result", "ToolOutputSchemas", "Output"],
	] as const) {
		for (const schema of schemas(union).filter((name) =>
			name.endsWith(suffix),
		)) {
			const stem = schema.slice(0, -suffix.length);
			const tool = TOOL_NAMES[stem] ?? stem;
			const definition = definitions.get(schema);
			if (definition === undefined) throw new Error(schema);
			tools.add(tool);
			const context = {
				tool,
				schema,
				direction,
				path:
					direction === "input"
						? `assistant.message.content[tool_use:${tool}].input`
						: "user.toolUseResult",
				source: `sdk-tools.d.ts:${line(definition)}`,
				optional: false,
				comment: comment(definition),
			};
			if (ts.isTypeAliasDeclaration(definition))
				expand(definition.type, context, [schema]);
			else {
				emit(context, "object");
				members(definition.members, context, [schema]);
			}
		}
	}
	return {
		version,
		claudeCodeVersion,
		sha256: createHash("sha256").update(text).digest("hex"),
		tools: [...tools].sort(),
		paths: [...paths.values()].sort(
			(left, right) =>
				left.tool.localeCompare(right.tool) ||
				left.direction.localeCompare(right.direction) ||
				left.path.localeCompare(right.path) ||
				left.source.localeCompare(right.source) ||
				left.type.localeCompare(right.type),
		),
		diagnostics: [...diagnostics].sort(),
	};
}
