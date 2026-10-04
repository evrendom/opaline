import {
	formatInlineImageSize,
	readInlineImageMarkerFromSource,
} from "@rudel/api-routes";
import { CodeBlock } from "./CodeBlock";
import { formatShellOutput } from "./conversation-tools";
import type { TraceToolResult } from "./conversation-trace";

const SAFE_IMAGE_MEDIA_TYPE_PATTERN = /^image\/(?:gif|jpeg|png|webp)$/u;
const SAFE_IMAGE_DATA_URL_PATTERN =
	/^data:image\/(?:gif|jpeg|png|webp);base64,[a-zA-Z0-9+/=\s]+$/u;

export function TraceResultBody({ result }: { result: TraceToolResult }) {
	if (typeof result.content === "string") {
		return <TraceResultText result={result} text={result.content} />;
	}

	const text = result.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n");
	const nonTextBlocks = result.content.filter((block) => block.type !== "text");
	const occurrenceBySignature = new Map<string, number>();
	const keyedNonTextBlocks = nonTextBlocks.map((block) => {
		const signature = getResultBlockSignature(block);
		const occurrence = occurrenceBySignature.get(signature) ?? 0;
		occurrenceBySignature.set(signature, occurrence + 1);
		return { block, key: `${signature}:${occurrence}` };
	});

	return (
		<div className="grid gap-3" data-trace-result-blocks>
			{text || nonTextBlocks.length === 0 ? (
				<TraceResultText result={result} text={text} />
			) : null}
			{keyedNonTextBlocks.map(({ block, key }) => {
				if (block.type === "image") {
					const omitted = readInlineImageMarkerFromSource(block.source);
					if (omitted) {
						return (
							<p
								className="text-[0.8125rem] text-[color:var(--dashboardy-muted)]"
								data-trace-result-image-omitted
								key={key}
							>
								Screenshot taken (image not stored) · {omitted.mediaType} ·{" "}
								{formatInlineImageSize(omitted.bytes)}
							</p>
						);
					}
					const source = getSafeImageSource(block.source);
					return source ? (
						<img
							alt="Tool result"
							className="max-h-[32rem] max-w-full rounded-md border border-[color:var(--dashboardy-border)] object-contain"
							data-trace-result-image
							decoding="async"
							key={key}
							loading="lazy"
							src={source}
						/>
					) : (
						<p
							className="text-[0.8125rem] text-[color:var(--dashboardy-muted)]"
							data-trace-result-image-unavailable
							key={key}
						>
							Image result unavailable
						</p>
					);
				}

				return (
					<CodeBlock
						code={formatStructuredValue(block.value)}
						filename="Structured Output"
						key={key}
						language="json"
						showLineNumbers
					/>
				);
			})}
		</div>
	);
}

function getResultBlockSignature(
	block: Exclude<TraceToolResult["content"], string>[number],
) {
	const serialized = JSON.stringify(block);
	let hash = 2_166_136_261;
	for (let index = 0; index < serialized.length; index += 1) {
		hash ^= serialized.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return `${block.type}:${block.rawType}:${hash >>> 0}`;
}

function TraceResultText({
	result,
	text,
}: {
	result: TraceToolResult;
	text: string;
}) {
	const output = formatShellOutput(text || "No output");
	return (
		<CodeBlock
			code={output.text}
			filename={result.isError ? "Error Output" : "Output"}
			language={output.language}
			showLineNumbers
		/>
	);
}

function getSafeImageSource(source: unknown) {
	if (typeof source === "string") {
		return isSafeImageUrl(source) ? source : undefined;
	}
	if (typeof source !== "object" || source === null) {
		return undefined;
	}

	const value = source as Record<string, unknown>;
	if (value.type === "url" && typeof value.url === "string") {
		return isSafeImageUrl(value.url) ? value.url : undefined;
	}
	const mediaType = value.media_type ?? value.mediaType;
	if (
		value.type === "base64" &&
		typeof mediaType === "string" &&
		SAFE_IMAGE_MEDIA_TYPE_PATTERN.test(mediaType) &&
		typeof value.data === "string" &&
		/^[a-zA-Z0-9+/=\s]+$/u.test(value.data)
	) {
		return `data:${mediaType};base64,${value.data}`;
	}
	return undefined;
}

function isSafeImageUrl(value: string) {
	return /^https:\/\//u.test(value) || SAFE_IMAGE_DATA_URL_PATTERN.test(value);
}

function formatStructuredValue(value: unknown) {
	try {
		return JSON.stringify(value, null, 2) ?? "null";
	} catch {
		return "Structured output could not be serialized";
	}
}
