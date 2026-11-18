import type { DownloadProgress } from "./download.js";
import type { ServiceName } from "./processes.js";
import type { ResolvedRuntime, RuntimeName } from "./runtimes.js";

export type ServerEvent =
	| {
			readonly type: "runtime";
			readonly name: RuntimeName;
			readonly phase: "download";
			readonly received: number;
			readonly total: number;
	  }
	| {
			readonly type: "runtime";
			readonly name: RuntimeName;
			readonly phase: "ready";
			readonly version: string;
			readonly source: ResolvedRuntime["source"];
			readonly path: string;
	  }
	| {
			readonly type: "starting";
			readonly service: ServiceName;
			readonly version?: string;
	  }
	| {
			readonly type: "ready";
			readonly url: string;
			readonly localUrl: string;
			readonly version?: string;
			readonly alreadyRunning: boolean;
	  }
	| {
			readonly type: "setup";
			readonly created: boolean;
			readonly credentials: "write" | "keep" | "unchanged";
			readonly user: {
				readonly id: string;
				readonly email: string;
				readonly name: string;
			};
			readonly organization: {
				readonly id: string;
				readonly slug: string;
				readonly name: string;
			};
	  }
	| {
			readonly type: "agents";
			readonly hooks: readonly {
				readonly agent: "claude_code" | "codex";
				readonly status: string;
			}[];
			readonly mcp: readonly string[];
	  }
	| { readonly type: "login"; readonly url: string }
	| {
			readonly type: "log";
			readonly level: "info" | "warning";
			readonly message: string;
	  }
	| { readonly type: "done"; readonly url: string }
	| { readonly type: "error"; readonly message: string };

export type ServerEventSink = (event: ServerEvent) => void;

export function createJsonLineSink(
	stream: { readonly write: (line: string) => unknown } = process.stdout,
): ServerEventSink {
	return (event) => {
		stream.write(`${JSON.stringify(event)}\n`);
	};
}

const RUNTIME_LABELS: Record<string, RuntimeName> = {
	clickhouse: "clickhouse",
	postgres: "postgres",
	bun: "bun",
};

export function runtimeNameFromLabel(label: string): RuntimeName | undefined {
	const lower = label.toLowerCase();
	for (const [needle, name] of Object.entries(RUNTIME_LABELS))
		if (lower.includes(needle)) return name;
	return undefined;
}

export function createEventProgress(
	sink: ServerEventSink,
	minIntervalMs = 250,
): (label: string) => {
	update: (progress: DownloadProgress) => void;
	finish: () => void;
} {
	return (label) => {
		const name = runtimeNameFromLabel(label);
		let last = 0;
		let lastReceived = -1;
		return {
			update({ received, total }) {
				if (!name) return;
				const now = Date.now();
				const complete = total > 0 && received >= total;
				if (!complete && now - last < minIntervalMs) return;
				if (received === lastReceived) return;
				last = now;
				lastReceived = received;
				sink({ type: "runtime", name, phase: "download", received, total });
			},
			finish() {},
		};
	};
}
