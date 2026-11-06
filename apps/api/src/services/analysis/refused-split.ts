import type { MeasureParams } from "./retro-measure-sql.js";
import type { SqlFailure } from "./sql-guard.js";

export const SPLIT_STATEMENTS = 8;
export const SPLIT_WALL_MS = 180_000;

const DAY = 86_400_000;

type Limit = NonNullable<SqlFailure["limit"]>;

export class LimitRefusal extends Error {
	constructor(readonly failure: SqlFailure & { readonly limit: Limit }) {
		super(failure.message);
		this.name = "LimitRefusal";
	}
}

export function limitRefusal(failure: SqlFailure): LimitRefusal | null {
	return failure.limit
		? new LimitRefusal({ ...failure, limit: failure.limit })
		: null;
}

export interface SplitBudget {
	readonly statements: number;
	readonly wallMs: number;
	readonly deadline: number;
	readonly now: () => number;
	readonly notes: string[];
	readonly partial: string[];
}

export function splitBudget(
	options: { statements?: number; wallMs?: number; now?: () => number } = {},
): SplitBudget {
	const now = options.now ?? Date.now;
	const wallMs = options.wallMs ?? SPLIT_WALL_MS;
	return {
		statements: options.statements ?? SPLIT_STATEMENTS,
		wallMs,
		deadline: now() + wallMs,
		now,
		notes: [],
		partial: [],
	};
}

const dayOf = (value: string) => Date.parse(`${value}T00:00:00Z`);
const dateOf = (time: number) => new Date(time).toISOString().slice(0, 10);

export function windowDays(window: Pick<MeasureParams, "from" | "to">): number {
	return Math.round((dayOf(window.to) - dayOf(window.from)) / DAY) + 1;
}

export function halves<T extends Pick<MeasureParams, "from" | "to">>(
	window: T,
): [T, T] | null {
	const days = windowDays(window);
	if (days < 2) return null;
	const end = dayOf(window.from) + (Math.ceil(days / 2) - 1) * DAY;
	return [
		{ ...window, to: dateOf(end) },
		{ ...window, from: dateOf(end + DAY) },
	];
}

const LIMIT_NAMES: Readonly<Record<Limit, string>> = {
	memory: "memory",
	time: "time",
};

export type SplitOutcome<T> =
	| { readonly ok: true; readonly values: T[] }
	| {
			readonly ok: false;
			readonly line: string;
			readonly refusal: LimitRefusal | null;
	  };

export async function runSplit<T>(
	stage: string,
	window: MeasureParams,
	run: (window: MeasureParams, piece: boolean) => Promise<T>,
	budget: SplitBudget,
	options: { readonly approximate?: string } = {},
): Promise<SplitOutcome<T>> {
	const values: T[] = [];
	let used = 0;
	let refusal: LimitRefusal | null = null;
	const range = (piece: MeasureParams) => `${piece.from}..${piece.to}`;
	const why = () =>
		refusal ? `a ${LIMIT_NAMES[refusal.failure.limit]} refusal` : "";
	const attempt = async (piece: MeasureParams): Promise<string | null> => {
		if (budget.now() >= budget.deadline)
			return `${stage} refused at ${range(piece)} (past the call's ${budget.wallMs / 1000} s wall cap${refusal ? ` after ${why()}` : ""})`;
		if (used >= budget.statements)
			return `${stage} refused at ${range(piece)} (${why()}; its ${budget.statements} statements are used)`;
		used += 1;
		try {
			values.push(await run(piece, piece !== window));
			return null;
		} catch (error) {
			if (!(error instanceof LimitRefusal)) throw error;
			refusal = error;
			const split = window.latest ? null : halves(piece);
			if (!split)
				return `${stage} refused at ${range(piece)} (${why()}; ${window.latest ? "a latest-sessions cohort is not split by time" : "one day is the smallest window"})`;
			for (const half of split) {
				const failed = await attempt(half);
				if (failed) return failed;
			}
			return null;
		}
	};
	const failed = await attempt(window);
	if (failed) {
		const line = `partial: ${failed}`;
		budget.partial.push(line);
		return { ok: false, line, refusal };
	}
	if (values.length > 1)
		budget.notes.push(
			`${stage} ran as ${values.length} windows after ${why()}${options.approximate ? `; ${options.approximate}` : ""}`,
		);
	return { ok: true, values };
}
