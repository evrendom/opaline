import { getRawToolInput } from "@rudel/api-routes";
import { getShellCommand } from "@/components/conversation/conversation-tools";
import type { SessionReaderStep } from "@/features/sessions/reader/model/session-reader-run-steps";
import { activityOf } from "@/features/sessions/reader/model/session-reader-step-lanes";
import { basename } from "@/lib/format";

export type Attempt = {
	id: string;
	number: number;
	steps: SessionReaderStep[];
	startMs: number;
	endMs: number;
	intent: string | null;
	said: string | null;
	thought: string | null;
	saidStep: SessionReaderStep | null;
	thoughtSteps: SessionReaderStep[];
	answer: boolean;
	check: SessionReaderStep | null;
	outcome: "failed" | "none" | "passed";
	error: string | null;
	edited: string[];
	readCount: number;
	tryNumber: { n: number; of: number } | null;
	sameErrorAs: number | null;
	reread: string[];
	reedited: string[];
};

const READ_TOOLS = new Set(["Read", "read_file", "view_image"]);

function commandOf(step: SessionReaderStep): string {
	const event = step.toolEvent;
	if (!event) return "";
	return getShellCommand(event.toolName, getRawToolInput(event.input)) ?? "";
}

function checkKey(step: SessionReaderStep): string {
	return (commandOf(step) || step.name).replace(/\s+/gu, " ").trim();
}

const GENERIC_ERROR = /^(?:exit code -?\d+|error:?|command failed)$/iu;

function errorKey(step: SessionReaderStep): string | null {
	const line = step.result
		?.split("\n")
		.map((candidate) => candidate.trim())
		.find(
			(candidate) => candidate.length > 0 && !GENERIC_ERROR.test(candidate),
		);
	if (!line) return null;
	const said = line.replace(/\d+/gu, "#").replace(/\s+/gu, " ").slice(0, 160);
	return `${checkKey(step)}\n${said}`;
}

const firstLine = (text: string | null) =>
	text
		?.split("\n")
		.map((line) => line.trim())
		.find(Boolean) ?? null;

function isCheck(step: SessionReaderStep): boolean {
	if (step.kind !== "tool") return false;
	return activityOf(step) === "verify" || step.isError;
}

const lastDone = (steps: readonly SessionReaderStep[]) =>
	steps.filter((step) => step.kind !== "thinking").at(-1);

export function getAttempts(steps: readonly SessionReaderStep[]): Attempt[] {
	const own = steps.filter((step) => step.kind !== "ci");
	const answerId = own
		.filter((step) => step.kind === "message" && !step.writes)
		.at(-1)?.id;
	const groups: { steps: SessionReaderStep[]; answer: boolean }[] = [];
	let current: SessionReaderStep[] = [];
	const close = (answer = false) => {
		if (current.length > 0) groups.push({ answer, steps: current });
		current = [];
	};
	let checked = false;
	for (const step of own) {
		if (step.id === answerId) {
			close();
			current = [step];
			close(true);
			continue;
		}
		if (checked && step.kind !== "thinking") {
			close();
			checked = false;
		}
		if (
			step.kind === "message" &&
			!step.writes &&
			current.some(
				(earlier) => earlier.kind === "tool" || earlier.kind === "agent",
			)
		)
			close();
		current.push(step);
		if (isCheck(step)) checked = true;
	}
	close();

	const runsOf = new Map<string, number>();
	for (const group of groups) {
		const check = lastDone(group.steps);
		if (check && isCheck(check)) {
			const key = checkKey(check);
			runsOf.set(key, (runsOf.get(key) ?? 0) + 1);
		}
	}
	const seenRuns = new Map<string, number>();
	const errorsSeen = new Map<string, number>();
	const readBefore = new Set<string>();
	const editedBefore = new Set<string>();
	return groups.map((group, index) => {
		const number = index + 1;
		const last = lastDone(group.steps);
		const check = last && isCheck(last) ? last : null;
		const reads = group.steps
			.filter(
				(step) => READ_TOOLS.has(step.toolEvent?.toolName ?? "") && step.detail,
			)
			.map((step) => step.detail as string);
		const edits = group.steps
			.filter((step) => activityOf(step) === "edit" && step.detail)
			.map((step) => step.detail as string);
		const reread = [...new Set(reads.filter((path) => readBefore.has(path)))];
		const reedited = [
			...new Set(edits.filter((path) => editedBefore.has(path))),
		];
		for (const path of reads) readBefore.add(path);
		for (const path of edits) editedBefore.add(path);
		let tryNumber: Attempt["tryNumber"] = null;
		let sameErrorAs: number | null = null;
		let error: string | null = null;
		if (check) {
			const key = checkKey(check);
			const n = (seenRuns.get(key) ?? 0) + 1;
			seenRuns.set(key, n);
			const of = runsOf.get(key) ?? 1;
			if (of > 1) tryNumber = { n, of };
			if (check.isError) {
				error = firstLine(check.result);
				const signature = errorKey(check);
				if (signature) {
					sameErrorAs = errorsSeen.get(signature) ?? null;
					if (sameErrorAs === null) errorsSeen.set(signature, number);
				}
			}
		}
		const said = group.steps.find(
			(step) => step.kind === "message" && step.text,
		);
		const thought = group.steps.find(
			(step) => step.kind === "thinking" && step.text,
		);
		const saidAt = said ? group.steps.indexOf(said) : -1;
		const thoughtSteps = group.steps
			.slice(0, Math.max(saidAt, 0))
			.filter((step) => step.kind === "thinking" && step.text?.trim());
		const thinking = thoughtSteps.map((step) => step.text?.trim()).join("\n\n");
		return {
			answer: group.answer,
			check,
			edited: [...new Set(edits.map(basename))],
			endMs: Math.max(
				...group.steps.map((step) => step.backgroundFromMs ?? step.endMs),
			),
			error,
			id: (group.steps[0] as SessionReaderStep).id,
			intent: firstLine(said?.text ?? thought?.text ?? null),
			said: said?.text?.trim() || null,
			thought: thinking || null,
			saidStep: said?.text?.trim() ? said : null,
			thoughtSteps,
			number,
			outcome: check ? (check.isError ? "failed" : "passed") : "none",
			readCount: reads.length,
			reedited: reedited.map(basename),
			reread: reread.map(basename),
			sameErrorAs,
			startMs: (group.steps[0] as SessionReaderStep).startMs,
			steps: group.steps,
			tryNumber,
		};
	});
}
