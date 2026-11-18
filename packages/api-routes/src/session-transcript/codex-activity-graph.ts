import {
	type ExtractedCodexInvocation,
	extractCustomExecInvocations,
	maskJavaScriptNonCode,
} from "./codex-javascript-extractor.js";

const CODEX_OPERATION_KEY = "__rudel_codex_operation";

const LIFECYCLE_TYPES = new Set([
	"exec_command_end",
	"mcp_tool_call_end",
	"patch_apply_end",
	"web_search_end",
]);

const NODE_REPL_BROWSER_BINDING_NAMES = [
	"browser",
	"diaState",
	"page",
	"tab",
] as const;

const BROWSER_OPERATION_METHOD_PATTERN =
	/\b(?:click|close|content|dblclick|dragAndDrop|evaluate|fill|getBy(?:AltText|Label|Placeholder|Role|TestId|Text|Title)|goBack|goForward|goto|hover|locator|newPage|pages|press|reload|screenshot|selectOption|setInputFiles|tap|type|waitFor|waitForLoadState|waitForTimeout)\s*\(/u;

export type CodexCorrelationConfidence =
	| "ambiguous-positional"
	| "exact-id"
	| "positional"
	| "unmatched";

export type CodexOutputBlock =
	| { rawType: string; text: string; type: "text" }
	| { rawType: string; source: unknown; type: "image" }
	| { rawType: string; type: "structured"; value: unknown };

export type CodexLifecycleRecord = {
	callId: string | undefined;
	confidence: CodexCorrelationConfidence;
	id: string;
	lineIndex: number;
	outputBlocks: readonly CodexOutputBlock[];
	payload: Readonly<Record<string, unknown>>;
	timestamp: string;
	type: string;
};

export type CodexOrphanOutput = {
	callId: string | undefined;
	id: string;
	lineIndex: number;
	outputBlocks: readonly CodexOutputBlock[];
	timestamp: string;
};

export type CodexOutputRecord = {
	id: string;
	lineIndex: number;
	outputBlocks: readonly CodexOutputBlock[];
	source: "lifecycle" | "response";
};

export type CodexNormalizedOperation = {
	argumentSource: string | undefined;
	carrierId: string | undefined;
	computerUseTarget: string | undefined;
	correlation: CodexCorrelationConfidence | undefined;
	expansionIndex: number;
	expansionPath: readonly number[];
	id: string;
	input: Readonly<Record<string, unknown>>;
	lifecycle: CodexLifecycleRecord | undefined;
	name: string;
	outputBlocks: readonly CodexOutputBlock[];
	outputScope: "carrier" | "mixed" | "operation" | undefined;
	resolvedInput: boolean;
	source: string | undefined;
	sourceOffset: number;
	timestamp: string;
};

export type CodexCarrier = {
	agentName: string | undefined;
	callId: string;
	callLineIndex: number;
	input: Readonly<Record<string, unknown>>;
	name: string;
	operations: readonly CodexNormalizedOperation[];
	outputBlocks: readonly CodexOutputBlock[];
	outputLineIndex: number | undefined;
	rawSource: string | undefined;
	timestamp: string;
};

export type CodexActivityGraph = {
	carriers: readonly CodexCarrier[];
	lifecycleRecords: readonly CodexLifecycleRecord[];
	malformedLines: number;
	orphanOutputs: readonly CodexOrphanOutput[];
	outputRecords: readonly CodexOutputRecord[];
	standaloneOperations: readonly CodexNormalizedOperation[];
};

export type CodexOperationMetadata = {
	hasSharedOutput?: boolean;
	carrierOperationCount?: number;
	argumentSource: string | undefined;
	carrierId: string | undefined;
	carrierInput: Readonly<Record<string, unknown>> | undefined;
	carrierName: string | undefined;
	carrierSource: string | undefined;
	computerUseTarget: string | undefined;
	correlation: CodexCorrelationConfidence | undefined;
	expansionIndex: number;
	expansionPath: readonly number[];
	lifecycle: Readonly<Record<string, unknown>> | undefined;
	operationId: string;
	outputScope: "carrier" | "mixed" | "operation" | undefined;
	provider: "codex";
	resolvedInput: boolean;
	sourceOffset: number;
};

type ParsedCodexLine = {
	index: number;
	payload: Readonly<Record<string, unknown>>;
	raw: string;
	timestamp: string;
	type: string;
};

type MutableOperation = {
	argumentSource: string | undefined;
	carrierId: string | undefined;
	computerUseTarget: string | undefined;
	correlation: CodexCorrelationConfidence | undefined;
	expansionIndex: number;
	expansionPath: readonly number[];
	id: string;
	input: Readonly<Record<string, unknown>>;
	lifecycle: CodexLifecycleRecord | undefined;
	name: string;
	outputBlocks: CodexOutputBlock[];
	outputScope: "carrier" | "mixed" | "operation" | undefined;
	resolvedInput: boolean;
	source: string | undefined;
	sourceOffset: number;
	timestamp: string;
};

type MutableCarrier = {
	agentName: string | undefined;
	callId: string;
	callLineIndex: number;
	input: Readonly<Record<string, unknown>>;
	name: string;
	operations: MutableOperation[];
	outputBlocks: CodexOutputBlock[];
	outputLineIndex: number | undefined;
	rawSource: string | undefined;
	timestamp: string;
};

export function buildCodexActivityGraph(content: string): CodexActivityGraph {
	const parsed = parseCodexLines(content);
	const carriers = collectCarriers(parsed.lines);
	const responseOutputs = attachCarrierOutputs(carriers, parsed.lines);
	const lifecycleRecords = collectLifecycleRecords(parsed.lines);
	const standaloneOperations = correlateLifecycleRecords(
		carriers,
		lifecycleRecords,
	);
	attachOperationOutputs(carriers);
	classifyComputerUseOperations(carriers, standaloneOperations);
	const outputRecords: CodexOutputRecord[] = [
		...responseOutputs.outputRecords,
		...lifecycleRecords.map((lifecycle) => ({
			id: lifecycle.id,
			lineIndex: lifecycle.lineIndex,
			outputBlocks: lifecycle.outputBlocks,
			source: "lifecycle" as const,
		})),
	].sort((left, right) => left.lineIndex - right.lineIndex);

	return {
		carriers,
		lifecycleRecords,
		malformedLines: parsed.malformedLines,
		orphanOutputs: responseOutputs.orphanOutputs,
		outputRecords,
		standaloneOperations,
	};
}

export function attachCodexOperationMetadata(
	input: Readonly<Record<string, unknown>>,
	operation: CodexNormalizedOperation,
	carrier: CodexCarrier | undefined,
): Record<string, unknown> {
	const metadata: CodexOperationMetadata = {
		hasSharedOutput: Boolean(
			carrier &&
				carrier.operations.length > 1 &&
				carrier.outputBlocks.length > 0,
		),
		carrierOperationCount: carrier?.operations.length,
		argumentSource: operation.argumentSource,
		carrierId: operation.carrierId,
		carrierInput: carrier?.input,
		carrierName: carrier?.name,
		carrierSource: carrier?.rawSource,
		computerUseTarget: operation.computerUseTarget,
		correlation: operation.correlation,
		expansionIndex: operation.expansionIndex,
		expansionPath: operation.expansionPath,
		lifecycle: operation.lifecycle
			? sanitizeLifecyclePayload(operation.lifecycle.payload)
			: undefined,
		operationId: operation.id,
		outputScope: operation.outputScope,
		provider: "codex",
		resolvedInput: operation.resolvedInput,
		sourceOffset: operation.sourceOffset,
	};
	const serializedMetadata = Object.fromEntries(
		Object.entries(metadata).filter(([, value]) => value !== undefined),
	);
	return { ...input, [CODEX_OPERATION_KEY]: serializedMetadata };
}

function sanitizeLifecyclePayload(
	payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const result = readRecord(payload.result);
	const ok = readRecord(result?.Ok) ?? readRecord(result?.ok);
	const hasErrorResult = Boolean(
		result && ("Err" in result || "err" in result),
	);
	return {
		...Object.fromEntries(
			Object.entries(payload).filter(
				([key]) => key !== "output" && key !== "result",
			),
		),
		...(hasErrorResult
			? { result: { Err: true } }
			: ok?.isError === true
				? { result: { Ok: { isError: true } } }
				: {}),
	};
}

export function getCodexOperationMetadata(
	input: Readonly<Record<string, unknown>>,
): CodexOperationMetadata | undefined {
	const metadata = readRecord(input[CODEX_OPERATION_KEY]);
	if (
		metadata?.provider !== "codex" ||
		typeof metadata.operationId !== "string"
	) {
		return undefined;
	}
	return {
		carrierOperationCount: readFiniteNumber(metadata.carrierOperationCount),
		hasSharedOutput: metadata.hasSharedOutput === true,
		argumentSource: readOptionalString(metadata.argumentSource),
		carrierId: readOptionalString(metadata.carrierId),
		carrierInput: readRecord(metadata.carrierInput),
		carrierName: readOptionalString(metadata.carrierName),
		carrierSource: readOptionalString(metadata.carrierSource),
		computerUseTarget: readOptionalString(metadata.computerUseTarget),
		correlation: readCorrelation(metadata.correlation),
		expansionIndex: readFiniteNumber(metadata.expansionIndex) ?? 0,
		expansionPath: readNumberArray(metadata.expansionPath),
		lifecycle: readRecord(metadata.lifecycle),
		operationId: metadata.operationId,
		outputScope: readOutputScope(metadata.outputScope),
		provider: "codex",
		resolvedInput: metadata.resolvedInput === true,
		sourceOffset: readFiniteNumber(metadata.sourceOffset) ?? 0,
	};
}

export function isCodexOperationInput(
	input: Readonly<Record<string, unknown>>,
) {
	return getCodexOperationMetadata(input) !== undefined;
}

export function getCodexRawOperationInput(
	input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(input).filter(([key]) => key !== CODEX_OPERATION_KEY),
	);
}

export function toConversationResultContent(
	blocks: readonly CodexOutputBlock[],
):
	| string
	| (
			| { rawType: string; text: string; type: "text" }
			| { rawType: string; source: unknown; type: "image" }
			| { rawType: string; type: "structured"; value: unknown }
	  )[] {
	if (blocks.length === 1 && blocks[0]?.type === "text") {
		return blocks[0].text;
	}
	return [...blocks];
}

function parseCodexLines(content: string) {
	const lines: ParsedCodexLine[] = [];
	let malformedLines = 0;
	const rawLines = content.split("\n");
	for (let index = 0; index < rawLines.length; index++) {
		const raw = rawLines[index] ?? "";
		if (!raw.trim()) {
			continue;
		}
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			malformedLines += 1;
			continue;
		}
		const record = readRecord(value);
		const payload = readRecord(record?.payload);
		if (!record || !payload) {
			continue;
		}
		lines.push({
			index,
			payload,
			raw,
			timestamp: readOptionalString(record.timestamp) ?? "",
			type: readOptionalString(record.type) ?? "",
		});
	}
	return { lines, malformedLines };
}

function collectCarriers(lines: readonly ParsedCodexLine[]) {
	const carriers: MutableCarrier[] = [];
	for (const line of lines) {
		if (line.type !== "response_item" || !isCallPayload(line.payload)) {
			continue;
		}
		const callId =
			readOptionalString(line.payload.call_id) ?? `codex-carrier-${line.index}`;
		const name = readCarrierName(line.payload);
		const input = readCarrierInput(line.payload);
		const rawSource =
			line.payload.type === "custom_tool_call" &&
			typeof line.payload.input === "string"
				? line.payload.input
				: undefined;
		const carrier: MutableCarrier = {
			agentName: readAgentName(line.payload),
			callId,
			callLineIndex: line.index,
			input,
			name,
			operations: [],
			outputBlocks: [],
			outputLineIndex: undefined,
			rawSource,
			timestamp: line.timestamp,
		};
		carrier.operations.push(...createCarrierOperations(carrier));
		carriers.push(carrier);
	}
	return carriers;
}

function createCarrierOperations(carrier: MutableCarrier): MutableOperation[] {
	if (carrier.name !== "exec" || carrier.rawSource === undefined) {
		return [
			createOperation({
				argumentSource: undefined,
				carrier,
				expansionIndex: 0,
				expansionPath: [],
				input: carrier.input,
				name: carrier.name,
				resolvedInput: true,
				source: undefined,
				sourceOffset: 0,
			}),
		];
	}

	const invocations = extractCustomExecInvocations(carrier.rawSource);
	if (invocations.length === 0) {
		if (/@oai\/sky|\bsky\s*\./u.test(carrier.rawSource)) {
			return [
				createOperation({
					argumentSource: carrier.rawSource,
					carrier,
					expansionIndex: 0,
					expansionPath: [],
					input: { code: carrier.rawSource },
					name: "js",
					resolvedInput: true,
					source: carrier.rawSource,
					sourceOffset: 0,
				}),
			];
		}
		return [
			createOperation({
				argumentSource: carrier.rawSource,
				carrier,
				expansionIndex: 0,
				expansionPath: [],
				input: carrier.input,
				name: "exec",
				resolvedInput: false,
				source: carrier.rawSource,
				sourceOffset: 0,
			}),
		];
	}
	return invocations.map((invocation) =>
		createOperationFromInvocation(carrier, invocation),
	);
}

function createOperationFromInvocation(
	carrier: MutableCarrier,
	invocation: ExtractedCodexInvocation,
) {
	return createOperation({
		argumentSource: invocation.argumentSource,
		carrier,
		expansionIndex: invocation.expansionIndex,
		expansionPath: invocation.expansionPath,
		input: invocation.input,
		name: invocation.name,
		resolvedInput: invocation.resolvedInput,
		source: invocation.source,
		sourceOffset: invocation.sourceOffset,
	});
}

function createOperation({
	argumentSource,
	carrier,
	expansionIndex,
	expansionPath,
	input,
	name,
	resolvedInput,
	source,
	sourceOffset,
}: {
	argumentSource: string | undefined;
	carrier: MutableCarrier;
	expansionIndex: number;
	expansionPath: readonly number[];
	input: Readonly<Record<string, unknown>>;
	name: string;
	resolvedInput: boolean;
	source: string | undefined;
	sourceOffset: number;
}): MutableOperation {
	return {
		argumentSource,
		carrierId: carrier.callId,
		computerUseTarget: inferComputerUseTarget(name, input, undefined),
		correlation: undefined,
		expansionIndex,
		expansionPath,
		id: `${carrier.callId}:${sourceOffset}:${expansionPath.join(".") || expansionIndex}`,
		input,
		lifecycle: undefined,
		name,
		outputBlocks: [],
		outputScope: undefined,
		resolvedInput,
		source,
		sourceOffset,
		timestamp: carrier.timestamp,
	};
}

function attachCarrierOutputs(
	carriers: MutableCarrier[],
	lines: readonly ParsedCodexLine[],
) {
	const orphanOutputs: CodexOrphanOutput[] = [];
	const outputRecords: CodexOutputRecord[] = [];
	const carriersByCallId = new Map(
		carriers.map((carrier) => [carrier.callId, carrier]),
	);
	for (const line of lines) {
		if (line.type !== "response_item" || !isOutputPayload(line.payload)) {
			continue;
		}
		const callId = readOptionalString(line.payload.call_id);
		const carrier = callId ? carriersByCallId.get(callId) : undefined;
		const outputBlocks = normalizeCodexOutput(
			line.payload.type === "tool_search_output"
				? line.payload.tools
				: line.payload.output,
		);
		outputRecords.push({
			id: callId ?? `orphan-output-${line.index}`,
			lineIndex: line.index,
			outputBlocks,
			source: "response",
		});
		if (!carrier) {
			orphanOutputs.push({
				callId,
				id: callId ?? `orphan-output-${line.index}`,
				lineIndex: line.index,
				outputBlocks,
				timestamp: line.timestamp,
			});
			continue;
		}
		carrier.outputLineIndex = line.index;
		carrier.outputBlocks.push(...outputBlocks);
	}
	return { orphanOutputs, outputRecords };
}

function collectLifecycleRecords(lines: readonly ParsedCodexLine[]) {
	return lines.flatMap((line): CodexLifecycleRecord[] => {
		const type = readOptionalString(line.payload.type);
		if (line.type !== "event_msg" || !type || !LIFECYCLE_TYPES.has(type)) {
			return [];
		}
		const callId = readOptionalString(line.payload.call_id);
		return [
			{
				callId,
				confidence: "unmatched",
				id: callId ? `${type}:${callId}` : `${type}:line-${line.index}`,
				lineIndex: line.index,
				outputBlocks: readLifecycleOutput(line.payload),
				payload: line.payload,
				timestamp: line.timestamp,
				type,
			},
		];
	});
}

function correlateLifecycleRecords(
	carriers: MutableCarrier[],
	lifecycles: CodexLifecycleRecord[],
) {
	const standalone: MutableOperation[] = [];
	for (let index = 0; index < lifecycles.length; index++) {
		const lifecycle = lifecycles[index];
		if (!lifecycle) {
			continue;
		}
		const exact = lifecycle.callId
			? carriers.flatMap((carrier) =>
					carrier.callId === lifecycle.callId
						? compatibleOperations(carrier, lifecycle)
						: [],
				)
			: [];
		if (exact.length === 1 && exact[0]) {
			attachLifecycle(exact[0], lifecycle, "exact-id");
			lifecycles[index] = { ...lifecycle, confidence: "exact-id" };
			continue;
		}

		const positionalCarriers = carriers.filter(
			(carrier) =>
				carrier.callLineIndex < lifecycle.lineIndex &&
				(carrier.outputLineIndex ?? Number.POSITIVE_INFINITY) >=
					lifecycle.lineIndex,
		);
		const candidates = positionalCarriers.flatMap((carrier) =>
			compatibleOperations(carrier, lifecycle),
		);
		if (candidates.length === 1 && candidates[0]) {
			attachLifecycle(candidates[0], lifecycle, "positional");
			lifecycles[index] = { ...lifecycle, confidence: "positional" };
			continue;
		}
		if (candidates.length > 1) {
			lifecycles[index] = {
				...lifecycle,
				confidence: "ambiguous-positional",
			};
			continue;
		}

		standalone.push(createStandaloneLifecycleOperation(lifecycle));
	}
	return standalone;
}

function compatibleOperations(
	carrier: MutableCarrier,
	lifecycle: CodexLifecycleRecord,
) {
	return carrier.operations.filter(
		(operation) =>
			operation.lifecycle === undefined &&
			isLifecycleCompatible(operation.name, lifecycle.type),
	);
}

function isLifecycleCompatible(operationName: string, lifecycleType: string) {
	const normalized = normalizeToolName(operationName);
	if (lifecycleType === "exec_command_end") {
		return normalized === "exec_command";
	}
	if (lifecycleType === "patch_apply_end") {
		return normalized === "apply_patch";
	}
	if (lifecycleType === "mcp_tool_call_end") {
		return operationName.startsWith("mcp__") || normalized.includes("mcp");
	}
	if (lifecycleType === "web_search_end") {
		return normalized === "web__run" || normalized === "web_search_call";
	}
	return false;
}

function attachLifecycle(
	operation: MutableOperation,
	lifecycle: CodexLifecycleRecord,
	confidence: "exact-id" | "positional",
) {
	operation.lifecycle = { ...lifecycle, confidence };
	operation.correlation = confidence;
	operation.computerUseTarget = inferComputerUseTarget(
		operation.name,
		operation.input,
		lifecycle.payload,
	);
	const lifecycleOutput = lifecycle.outputBlocks;
	if (lifecycleOutput.length > 0) {
		operation.outputBlocks = [...lifecycleOutput];
		operation.outputScope = "operation";
	}
}

function createStandaloneLifecycleOperation(
	lifecycle: CodexLifecycleRecord,
): MutableOperation {
	const name = readLifecycleToolName(lifecycle);
	const input = readLifecycleInput(lifecycle);
	return {
		argumentSource: undefined,
		carrierId: undefined,
		computerUseTarget: inferComputerUseTarget(name, input, lifecycle.payload),
		correlation: "unmatched",
		expansionIndex: 0,
		expansionPath: [],
		id: `unmatched:${lifecycle.id}`,
		input,
		lifecycle,
		name,
		outputBlocks: [...lifecycle.outputBlocks],
		outputScope: "operation",
		resolvedInput: true,
		source: undefined,
		sourceOffset: 0,
		timestamp: lifecycle.timestamp,
	};
}

function attachOperationOutputs(carriers: MutableCarrier[]) {
	for (const carrier of carriers) {
		if (carrier.outputBlocks.length === 0) {
			continue;
		}
		if (carrier.operations.length === 1 && carrier.operations[0]) {
			const operation = carrier.operations[0];
			operation.outputBlocks.push(...carrier.outputBlocks);
			operation.outputScope =
				operation.outputScope === "operation" ? "mixed" : "carrier";
			continue;
		}
		const owner = carrier.operations.find(
			(operation) => operation.outputBlocks.length === 0,
		);
		if (owner) {
			owner.outputBlocks.push(...carrier.outputBlocks);
			owner.outputScope = "carrier";
			continue;
		}
		const transportOwner = carrier.operations[0];
		if (transportOwner) {
			transportOwner.outputBlocks.push(...carrier.outputBlocks);
			transportOwner.outputScope = "mixed";
		}
	}
}

function classifyComputerUseOperations(
	carriers: readonly MutableCarrier[],
	standaloneOperations: readonly MutableOperation[],
) {
	const browserBindings = new Set<string>(NODE_REPL_BROWSER_BINDING_NAMES);
	let hasBrowserStateLineage = false;
	for (const carrier of carriers) {
		for (const operation of carrier.operations) {
			const hasDirectBrowserEvidence =
				isComputerUseLifecycle(operation.lifecycle?.payload) ||
				hasSkyMarkers(operation.name, operation.input) ||
				hasLexedNodeReplBrowserBehavior(
					operation.name,
					operation.input,
					browserBindings,
				);
			operation.computerUseTarget = inferComputerUseTarget(
				operation.name,
				operation.input,
				operation.lifecycle?.payload,
				operation.outputBlocks,
				browserBindings,
				hasBrowserStateLineage,
			);
			if (operation.computerUseTarget !== undefined) {
				collectBrowserBindings(operation.input, browserBindings);
			}
			if (hasDirectBrowserEvidence) {
				hasBrowserStateLineage = true;
			}
		}
	}
	for (const operation of standaloneOperations) {
		operation.computerUseTarget = inferComputerUseTarget(
			operation.name,
			operation.input,
			operation.lifecycle?.payload,
			operation.outputBlocks,
			browserBindings,
			hasBrowserStateLineage,
		);
	}
}

export function normalizeCodexOutput(output: unknown): CodexOutputBlock[] {
	if (typeof output === "string") {
		const decoded = parseJsonContainer(output);
		return decoded === undefined
			? [{ rawType: "string", text: output, type: "text" }]
			: normalizeCodexOutput(decoded);
	}
	if (Array.isArray(output)) {
		return output.map(normalizeCodexOutputBlock);
	}
	return output === undefined
		? []
		: [{ rawType: typeof output, type: "structured", value: output }];
}

function normalizeCodexOutputBlock(value: unknown): CodexOutputBlock {
	const block = readRecord(value);
	const rawType = readOptionalString(block?.type) ?? typeof value;
	if (typeof block?.text === "string") {
		return { rawType, text: block.text, type: "text" };
	}
	const imageUrl = readOptionalString(block?.image_url);
	if (imageUrl !== undefined) {
		return {
			rawType,
			source: { type: "url", url: imageUrl },
			type: "image",
		};
	}
	if (rawType === "image" && block && "source" in block) {
		return { rawType, source: block.source, type: "image" };
	}
	return { rawType, type: "structured", value };
}

function readLifecycleOutput(payload: Readonly<Record<string, unknown>>) {
	const result = readRecord(payload.result);
	const ok = readRecord(result?.Ok) ?? readRecord(result?.ok);
	const error = readRecord(result?.Err) ?? readRecord(result?.err);
	const content = ok?.content ?? error?.content ?? payload.output;
	const blocks = normalizeCodexOutput(content);
	const metadata = readRecord(ok?._meta);
	const surface = readRecord(metadata?.["codex/toolSurface"]);
	const screenshot = readRecord(surface?.screenshot);
	const screenshotUrl = readOptionalString(screenshot?.url);
	return screenshotUrl
		? [
				...blocks,
				{
					rawType: "tool_surface_screenshot",
					source: { type: "url", url: screenshotUrl },
					type: "image" as const,
				},
			]
		: blocks;
}

function readLifecycleToolName(lifecycle: CodexLifecycleRecord) {
	if (lifecycle.type === "exec_command_end") {
		return "exec_command";
	}
	if (lifecycle.type === "patch_apply_end") {
		return "apply_patch";
	}
	if (lifecycle.type === "web_search_end") {
		return "web_search_call";
	}
	const invocation = readRecord(lifecycle.payload.invocation);
	return (
		readOptionalString(invocation?.tool_name) ??
		readOptionalString(invocation?.tool) ??
		readOptionalString(invocation?.name) ??
		"mcp_tool"
	);
}

function readLifecycleInput(lifecycle: CodexLifecycleRecord) {
	const { payload } = lifecycle;
	if (lifecycle.type === "web_search_end") {
		return {
			action:
				payload.action ??
				(typeof payload.query === "string" ? { query: payload.query } : {}),
		};
	}
	const invocation = readRecord(payload.invocation);
	const argumentsValue = invocation?.arguments;
	return readRecord(argumentsValue) ?? parseArguments(argumentsValue);
}

function inferComputerUseTarget(
	name: string,
	input: Readonly<Record<string, unknown>>,
	lifecycle: Readonly<Record<string, unknown>> | undefined,
	outputBlocks: readonly CodexOutputBlock[] = [],
	browserBindings: ReadonlySet<string> = new Set(
		NODE_REPL_BROWSER_BINDING_NAMES,
	),
	hasBrowserStateLineage = false,
) {
	const lifecycleEvidence = isComputerUseLifecycle(lifecycle);
	const skyEvidence = hasSkyMarkers(name, input);
	const lexedBrowserEvidence = hasLexedNodeReplBrowserBehavior(
		name,
		input,
		browserBindings,
	);
	const correlatedImageEvidence =
		hasNodeReplImageEvidence(name, outputBlocks) &&
		(lifecycleEvidence ||
			skyEvidence ||
			lexedBrowserEvidence ||
			hasBrowserStateLineage);
	if (
		!lifecycleEvidence &&
		!skyEvidence &&
		!lexedBrowserEvidence &&
		!correlatedImageEvidence
	) {
		return undefined;
	}
	const lifecycleTarget = readComputerUseLifecycleTarget(lifecycle);
	const code = readOptionalString(input.code) ?? "";
	const app =
		/\b(?:app|app_name)\s*:\s*["']([^"']+)["']/u.exec(code)?.[1] ??
		/\b(?:get_app_state|list_windows)\s*\(\s*["']([^"']+)["']/u.exec(code)?.[1];
	return app?.trim() || lifecycleTarget || "computer";
}

function hasNodeReplImageEvidence(
	name: string,
	outputBlocks: readonly CodexOutputBlock[],
) {
	return (
		name === "mcp__node_repl__js" &&
		outputBlocks.some((block) => block.type === "image")
	);
}

function hasLexedNodeReplBrowserBehavior(
	name: string,
	input: Readonly<Record<string, unknown>>,
	browserBindings: ReadonlySet<string>,
) {
	if (name !== "mcp__node_repl__js") {
		return false;
	}
	const code = readOptionalString(input.code);
	if (!code) {
		return false;
	}
	const mask = maskJavaScriptNonCode(code);
	if (
		hasBrowserModuleImport(code, mask) ||
		/\b(?:globalThis\s*\.\s*)?agent\s*\??\.\s*browsers\b/u.test(mask) ||
		/\bsky\b/u.test(mask) ||
		/\b(?:playwright|pw)\s*\.\s*(?:chromium|firefox|webkit)\b/u.test(mask)
	) {
		return true;
	}
	if (hasBrowserBindingReference(mask, browserBindings)) {
		return true;
	}
	for (const match of mask.matchAll(
		/\b([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\(/gu,
	)) {
		const receiver = match[1];
		const method = match[2];
		if (
			receiver &&
			method &&
			/(?:browser|context|page|tab)/iu.test(receiver) &&
			BROWSER_OPERATION_METHOD_PATTERN.test(`${method}(`)
		) {
			return true;
		}
	}
	return false;
}

function hasBrowserModuleImport(code: string, mask: string) {
	return hasImportedModule(
		code,
		mask,
		(moduleName) =>
			moduleName === "playwright" ||
			/(?:^|\/)browser-client\.mjs$/u.test(moduleName),
	);
}

function hasImportedModule(
	code: string,
	mask: string,
	matchesModule: (moduleName: string) => boolean,
) {
	for (const match of mask.matchAll(
		/\b(?:(?:import|require)\s*\(\s*|from\s+|import\s+)(["'])/gu,
	)) {
		if (match.index === undefined || !match[1]) {
			continue;
		}
		const quoteOffset = mask.indexOf(match[1], match.index);
		const moduleName = readQuotedLiteral(code, quoteOffset);
		if (moduleName && matchesModule(moduleName)) {
			return true;
		}
	}
	return false;
}

function hasBrowserBindingReference(
	mask: string,
	browserBindings: ReadonlySet<string>,
) {
	for (const binding of browserBindings) {
		const escapedBinding = escapeRegex(binding);
		const memberPattern = new RegExp(`\\b${escapedBinding}\\s*\\??\\.`, "u");
		if (memberPattern.test(mask)) {
			return true;
		}
	}
	return false;
}

function collectBrowserBindings(
	input: Readonly<Record<string, unknown>>,
	browserBindings: Set<string>,
) {
	const code = readOptionalString(input.code);
	if (!code) {
		return;
	}
	const mask = maskJavaScriptNonCode(code);
	const assignmentPattern =
		/(?:\b(?:const|let|var)\s+|(?:^|[;{}\n])\s*)([A-Za-z_$][\w$]*)\s*=/gmu;
	for (const match of mask.matchAll(assignmentPattern)) {
		const binding = match[1];
		if (!binding || match.index === undefined) {
			continue;
		}
		const valueStart = match.index + match[0].length;
		const statementEnd = mask.indexOf(";", valueStart);
		const valueMask = mask.slice(
			valueStart,
			statementEnd === -1 ? mask.length : statementEnd,
		);
		if (
			/\bsky\b/u.test(valueMask) ||
			/\b(?:globalThis\s*\.\s*)?agent\s*\??\.\s*browsers\b/u.test(valueMask) ||
			hasBrowserBindingReference(valueMask, browserBindings) ||
			/(?:^|\W)(?:browser|context|page|tab)[A-Za-z0-9_$]*\s*\??\./iu.test(
				valueMask,
			)
		) {
			browserBindings.add(binding);
		}
	}
}

function readQuotedLiteral(code: string, quoteOffset: number) {
	const quote = code[quoteOffset];
	if (quote !== '"' && quote !== "'") {
		return undefined;
	}
	let value = "";
	let escaped = false;
	for (let index = quoteOffset + 1; index < code.length; index += 1) {
		const character = code[index] ?? "";
		if (escaped) {
			value += character;
			escaped = false;
		} else if (character === "\\") {
			escaped = true;
		} else if (character === quote) {
			return value;
		} else {
			value += character;
		}
	}
	return undefined;
}

function escapeRegex(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isComputerUseLifecycle(
	lifecycle: Readonly<Record<string, unknown>> | undefined,
) {
	const result = readRecord(lifecycle?.result);
	const ok = readRecord(result?.Ok) ?? readRecord(result?.ok);
	const metadata = readRecord(ok?._meta);
	const surface = readRecord(metadata?.["codex/toolSurface"]);
	return ["browserUse", "computer-use", "computerUse"].includes(
		readOptionalString(surface?.kind) ?? "",
	);
}

function readComputerUseLifecycleTarget(
	lifecycle: Readonly<Record<string, unknown>> | undefined,
) {
	const result = readRecord(lifecycle?.result);
	const ok = readRecord(result?.Ok) ?? readRecord(result?.ok);
	const metadata = readRecord(ok?._meta);
	const surface = readRecord(metadata?.["codex/toolSurface"]);
	const target =
		readOptionalString(surface?.app) ??
		readOptionalString(surface?.appName) ??
		readOptionalString(surface?.backend);
	return target ? target.charAt(0).toUpperCase() + target.slice(1) : undefined;
}

function hasSkyMarkers(name: string, input: Readonly<Record<string, unknown>>) {
	if (normalizeToolName(name) !== "js") {
		return false;
	}
	const code = readOptionalString(input.code);
	if (!code) {
		return false;
	}
	const mask = maskJavaScriptNonCode(code);
	return (
		/\bsky\s*\./u.test(mask) ||
		hasImportedModule(
			code,
			mask,
			(moduleName) =>
				moduleName === "@oai/sky" || moduleName.startsWith("@oai/sky/"),
		)
	);
}

function isCallPayload(payload: Readonly<Record<string, unknown>>) {
	return [
		"custom_tool_call",
		"function_call",
		"multi_agent_call",
		"tool_search_call",
		"web_search_call",
	].includes(readOptionalString(payload.type) ?? "");
}

function isOutputPayload(payload: Readonly<Record<string, unknown>>) {
	return [
		"custom_tool_call_output",
		"function_call_output",
		"multi_agent_call_output",
		"tool_search_output",
	].includes(readOptionalString(payload.type) ?? "");
}

function readCarrierName(payload: Readonly<Record<string, unknown>>) {
	if (payload.type === "multi_agent_call") {
		return readOptionalString(payload.action) ?? "multi_agent";
	}
	if (payload.type === "web_search_call") {
		return "web_search_call";
	}
	if (payload.type === "tool_search_call") {
		return "tool_search";
	}
	return readOptionalString(payload.name) ?? "tool";
}

function readCarrierInput(payload: Readonly<Record<string, unknown>>) {
	if (payload.type === "custom_tool_call") {
		return { input: readOptionalString(payload.input) ?? "" };
	}
	if (payload.type === "web_search_call") {
		return {
			action: payload.action ?? {},
			...(typeof payload.status === "string" ? { status: payload.status } : {}),
		};
	}
	return parseArguments(payload.arguments);
}

function parseArguments(value: unknown): Record<string, unknown> {
	const record = readRecord(value);
	if (record) {
		return record;
	}
	if (typeof value !== "string" || !value) {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return { arguments: value };
	}
	return readRecord(parsed) ?? { arguments: value };
}

function parseJsonContainer(value: string): unknown {
	const trimmed = value.trim();
	if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function readAgentName(payload: Readonly<Record<string, unknown>>) {
	const agent = readRecord(payload.agent);
	return readOptionalString(agent?.agent_name);
}

function normalizeToolName(value: string) {
	return value.split(/\.|__/u).at(-1)?.toLowerCase() ?? value.toLowerCase();
}

function readOptionalString(value: unknown) {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function readFiniteNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function readNumberArray(value: unknown): readonly number[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is number =>
					typeof item === "number" && Number.isFinite(item),
			)
		: [];
}

function readCorrelation(
	value: unknown,
): CodexCorrelationConfidence | undefined {
	return value === "ambiguous-positional" ||
		value === "exact-id" ||
		value === "positional" ||
		value === "unmatched"
		? value
		: undefined;
}

function readOutputScope(value: unknown) {
	return value === "carrier" || value === "mixed" || value === "operation"
		? value
		: undefined;
}

function readRecord(
	value: unknown,
): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: undefined;
}
