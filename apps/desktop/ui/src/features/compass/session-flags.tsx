import { Menu } from "@base-ui/react/menu";
import {
	MOMENTS_MAX_LIMIT,
	type MomentKind,
	type NoticeableRun,
	type SessionDetailTurnSummary,
} from "@rudel/api-routes";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, startTransition, useMemo, useState } from "react";
import {
	OpalChip,
	Tip,
} from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import { railLineKey } from "@/features/sessions/reader/rail/session-reader-turn-rail-row";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { FlagKindsPopup } from "./compass-moments";
import { MOMENT_KINDS_APPEARANCE } from "./moment-labels";
import { useCompassAccess } from "./use-compass-access";

const MAX_PAGES = 10;
const MAX_TRIGGER_GLYPHS = 3;

const dayOf = (iso: string) => iso.slice(0, 10);

function useSessionFlaggedRuns(session: {
	from: string;
	sessionId: string;
	to: string;
}) {
	const { enabled } = useCompassAccess();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const startDate = dayOf(session.from);
	const endDate = dayOf(session.to);
	return useQuery({
		queryKey: [
			"org",
			organizationId,
			"compass-session-runs",
			session.sessionId,
			startDate,
			endDate,
		],
		enabled: enabled && !!organizationId,
		staleTime: 60_000,
		queryFn: async ({ signal }) => {
			const runs: NoticeableRun[] = [];
			let offset: number | null = 0;
			for (let page = 0; page < MAX_PAGES && offset !== null; page++) {
				const moments = await orpc.analytics.moments.list.call(
					{ startDate, endDate, limit: MOMENTS_MAX_LIMIT, offset },
					{ signal },
				);
				runs.push(
					...moments.noticeable.filter(
						(run) => run.sessionId === session.sessionId,
					),
				);
				offset = moments.nextOffset ?? null;
			}
			return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
		},
	});
}

function turnOf(
	run: Pick<NoticeableRun, "startedAt">,
	turns: readonly SessionDetailTurnSummary[],
	allLoaded: boolean,
): { index: number; turn: SessionDetailTurnSummary } | null {
	const at = Date.parse(run.startedAt);
	let found: { index: number; turn: SessionDetailTurnSummary } | null = null;
	for (const [index, turn] of turns.entries()) {
		if (turn.startedAt === null) continue;
		if (Date.parse(turn.startedAt) > at) return found;
		found = { index, turn };
	}
	return allLoaded ? found : null;
}

function compactedTurn(
	index: number,
	turns: readonly SessionDetailTurnSummary[],
): string {
	const from = turns[index] as SessionDetailTurnSummary;
	return (
		turns.slice(index, index + 2).find((turn) => (turn.compactions ?? 0) > 0)
			?.turnId ?? from.turnId
	);
}

export function flagsByTurn(
	runs: readonly {
		flags: readonly { kind: MomentKind }[];
		startedAt: string;
	}[],
	turns: readonly SessionDetailTurnSummary[],
	allLoaded: boolean,
): Map<string, MomentKind[]> {
	const byTurn = new Map<string, MomentKind[]>();
	for (const run of runs) {
		const found = turnOf(run, turns, allLoaded);
		if (!found) continue;
		for (const { kind } of run.flags) {
			const turnId =
				kind === "compaction"
					? compactedTurn(found.index, turns)
					: found.turn.turnId;
			const kinds = byTurn.get(turnId) ?? [];
			if (!kinds.includes(kind)) kinds.push(kind);
			byTurn.set(turnId, kinds);
		}
	}
	return byTurn;
}

export function flagsByLine(
	runs: readonly {
		agentId: string;
		flags: readonly { kind: MomentKind }[];
		startedAt: string;
	}[],
	turns: readonly SessionDetailTurnSummary[],
	allLoaded: boolean,
): Map<string, MomentKind[]> {
	const byLine = new Map<string, MomentKind[]>();
	for (const run of runs) {
		const found = turnOf(run, turns, allLoaded);
		if (!found) continue;
		for (const { kind } of run.flags) {
			const turnId =
				kind === "compaction" && run.agentId === ""
					? compactedTurn(found.index, turns)
					: found.turn.turnId;
			const key = railLineKey(turnId, run.agentId || null);
			const kinds = byLine.get(key) ?? [];
			if (!kinds.includes(kind)) kinds.push(kind);
			byLine.set(key, kinds);
		}
	}
	return byLine;
}

function useSessionFlags({
	from,
	sessionId,
	to,
	totalTurns,
	turns,
}: {
	from: string;
	sessionId: string;
	to: string;
	totalTurns: number;
	turns: readonly SessionDetailTurnSummary[];
}): {
	byLine: ReadonlyMap<string, readonly MomentKind[]>;
	byTurn: ReadonlyMap<string, readonly MomentKind[]>;
	loading: boolean;
} {
	const query = useSessionFlaggedRuns({ from, sessionId, to });
	const runs = query.data;
	const loading = query.isLoading;
	return useMemo(() => {
		const allLoaded = turns.length >= totalTurns;
		return {
			byLine: flagsByLine(runs ?? [], turns, allLoaded),
			byTurn: flagsByTurn(runs ?? [], turns, allLoaded),
			loading,
		};
	}, [loading, runs, turns, totalTurns]);
}

function FlagTag({ kinds }: { kinds: readonly MomentKind[] }) {
	const labels = kinds.map((kind) => MOMENT_KINDS_APPEARANCE[kind].label);
	return (
		<span className="flex shrink-0 items-center">
			<OpalChip
				solid
				tint="var(--color-rose-500)"
				title={labels.join(", ")}
				className="size-4 drop-shadow-none dark:drop-shadow-none"
			>
				<IconAlertTriangle aria-hidden="true" className="size-2.5 text-error" />
			</OpalChip>
			<span className="sr-only">Flagged: {labels.join(", ")}</span>
		</span>
	);
}

export function FlagChip({ kind }: { kind: MomentKind }) {
	const look = MOMENT_KINDS_APPEARANCE[kind];
	const Glyph = look.icon;
	return (
		<OpalChip solid tint={look.color} title={look.label} className="size-4">
			<Glyph
				aria-hidden="true"
				className="size-2.5"
				style={{ color: look.color }}
			/>
		</OpalChip>
	);
}

const keyOf = (kinds: ReadonlySet<MomentKind>) => [...kinds].sort().join();

const FLAG_ORDER = Object.keys(MOMENT_KINDS_APPEARANCE) as MomentKind[];

export function useTurnFlags(
	session: {
		from: string;
		sessionId: string;
		to: string;
		totalTurns: number;
		turns: readonly SessionDetailTurnSummary[];
	},
	scope: readonly SessionDetailTurnSummary[],
	agent: string | null,
): {
	enabled: boolean;
	flags: { kind: MomentKind; reasons: { detail: string; turnId: string }[] }[];
	pending: boolean;
} {
	const { enabled } = useCompassAccess();
	const query = useSessionFlaggedRuns(session);
	const { totalTurns, turns } = session;
	const flags = useMemo(() => {
		const inScope = new Set(scope.map((turn) => turn.turnId));
		const allLoaded = turns.length >= totalTurns;
		const byKind = new Map<MomentKind, { detail: string; turnId: string }[]>();
		for (const run of query.data ?? []) {
			if (run.agentId !== (agent ?? "")) continue;
			const found = turnOf(run, turns, allLoaded);
			if (!found) continue;
			for (const flag of run.flags) {
				const turnId =
					flag.kind === "compaction"
						? compactedTurn(found.index, turns)
						: found.turn.turnId;
				if (!inScope.has(turnId)) continue;
				byKind.set(flag.kind, [
					...(byKind.get(flag.kind) ?? []),
					{ detail: flag.detail, turnId },
				]);
			}
		}
		return FLAG_ORDER.flatMap((kind) => {
			const reasons = byKind.get(kind);
			return reasons ? [{ kind, reasons }] : [];
		});
	}, [agent, query.data, scope, totalTurns, turns]);
	return { enabled, flags, pending: enabled && query.isPending };
}

const FLAG_TRIGGER =
	"inline-flex h-7 w-fit min-w-7 shrink-0 items-center justify-center gap-xs corner-full bg-surface px-m text-body-m font-medium shadow-card transition-colors hover:bg-hover data-popup-open:bg-hover focus-outline";

function SessionFlagFilter({
	byKind,
	className,
	loading,
	onChange,
	picked,
	shown,
	total,
}: {
	byKind: ReadonlyMap<MomentKind, number>;
	className?: string;
	loading: boolean;
	onChange: (kinds: MomentKind[]) => void;
	picked: ReadonlySet<MomentKind>;
	shown: number;
	total: number;
}) {
	const [own, setOwn] = useState(picked);
	const [from, setFrom] = useState(() => keyOf(picked));
	if (from !== keyOf(picked)) {
		setFrom(keyOf(picked));
		setOwn(picked);
	}
	const menuPicks = new Set([...own].filter((kind) => byKind.has(kind)));
	if (byKind.size === 0)
		return loading ? (
			<button
				type="button"
				disabled
				aria-label="Loading flags"
				className={cn(
					FLAG_TRIGGER,
					"cursor-default text-ink-3 opacity-40 hover:bg-surface",
					className,
				)}
			>
				<IconAlertTriangle aria-hidden="true" className="size-3.5" />
			</button>
		) : null;
	const on = menuPicks.size > 0;
	const pick = (kinds: MomentKind[]) => {
		setOwn(new Set(kinds));
		startTransition(() => onChange(kinds));
	};
	return (
		<Menu.Root>
			<Tip
				label={
					on
						? [...menuPicks]
								.map((kind) => MOMENT_KINDS_APPEARANCE[kind].label)
								.join(", ")
						: "Filter turns by flag"
				}
				side="bottom"
			>
				<Menu.Trigger
					aria-label={
						on
							? `Turns flagged ${[...menuPicks].map((kind) => MOMENT_KINDS_APPEARANCE[kind].label).join(", ")}, ${shown}`
							: `Filter turns by flag, ${shown} flagged`
					}
					className={cn(
						FLAG_TRIGGER,
						on ? "text-ink" : "text-ink-3",
						className,
					)}
				>
					{on ? (
						<>
							{FLAG_ORDER.filter((kind) => menuPicks.has(kind))
								.slice(0, MAX_TRIGGER_GLYPHS)
								.map((kind) => {
									const look = MOMENT_KINDS_APPEARANCE[kind];
									const Glyph = look.icon;
									return (
										<Glyph
											key={kind}
											aria-hidden="true"
											className="size-3.5"
											style={{ color: look.color }}
										/>
									);
								})}
							{menuPicks.size > MAX_TRIGGER_GLYPHS ? (
								<span aria-hidden="true" className="tabular-nums">
									+{menuPicks.size - MAX_TRIGGER_GLYPHS}
								</span>
							) : null}
						</>
					) : (
						<IconAlertTriangle aria-hidden="true" className="size-3.5" />
					)}
				</Menu.Trigger>
			</Tip>
			<FlagKindsPopup
				align="start"
				any={{ count: total, label: "Any flag" }}
				count={(kind) => byKind.get(kind) ?? 0}
				onChange={pick}
				options={FLAG_ORDER.filter((kind) => byKind.has(kind))}
				picked={[...menuPicks]}
			/>
		</Menu.Root>
	);
}

export function useFlaggedTurns(session: {
	from: string;
	sessionId: string;
	to: string;
	totalTurns: number;
	turns: readonly SessionDetailTurnSummary[];
}): {
	filter: ReactNode;
	railTurns: readonly SessionDetailTurnSummary[];
	isShown: (turnId: string) => boolean;
	frustratedPrompts: ReadonlySet<string>;
	isFrustrated: (turn: SessionDetailTurnSummary) => boolean;
	tags: ReadonlyMap<string, ReactNode>;
} {
	const { byLine, byTurn: flagged, loading } = useSessionFlags(session);
	const [picked, setPicked] = useState<ReadonlySet<MomentKind>>(
		() => new Set(),
	);
	const tags = useMemo(
		() =>
			new Map(
				[...byLine].map(([line, kinds]) => [
					line,
					<FlagTag key={line} kinds={kinds} />,
				]),
			),
		[byLine],
	);
	const frustratedPrompts = useMemo(() => {
		const after = new Set<string>();
		for (const [index, turn] of session.turns.entries()) {
			const before = session.turns[index - 1];
			if (before && flagged.get(before.turnId)?.includes("user_frustrated"))
				after.add(turn.turnId);
		}
		return after;
	}, [session.turns, flagged]);
	const scope = session.turns;
	const byKind = useMemo(() => {
		const counts = new Map<MomentKind, number>();
		for (const turn of scope)
			for (const kind of flagged.get(turn.turnId) ?? [])
				counts.set(kind, (counts.get(kind) ?? 0) + 1);
		return counts;
	}, [scope, flagged]);
	const activeOf = (kinds: ReadonlySet<MomentKind>) =>
		new Set([...kinds].filter((kind) => byKind.has(kind)));
	const reading = useMemo(() => {
		const active = new Set([...picked].filter((kind) => byKind.has(kind)));
		const reactions = active.has("user_frustrated")
			? frustratedPrompts
			: new Set<string>();
		const keepsId = (turnId: string) => {
			if (reactions.has(turnId)) return true;
			const kinds = flagged.get(turnId);
			if (!kinds) return false;
			return active.size === 0 || kinds.some((kind) => active.has(kind));
		};
		const on = active.size > 0;
		const kept = scope.filter((turn) => keepsId(turn.turnId));
		return {
			isShown: on ? keepsId : () => true,
			kept,
			railTurns: on ? kept : scope,
		};
	}, [picked, byKind, flagged, scope, frustratedPrompts]);
	return {
		filter: (
			<SessionFlagFilter
				byKind={byKind}
				loading={loading}
				onChange={(kinds) => setPicked(new Set(kinds))}
				picked={activeOf(picked)}
				shown={reading.kept.length}
				total={scope.filter((turn) => flagged.has(turn.turnId)).length}
			/>
		),
		railTurns: reading.railTurns,
		isShown: reading.isShown,
		frustratedPrompts,
		isFrustrated: (turn) =>
			frustratedPrompts.has(turn.turnId) ||
			turn.signalOccurrences.some((signal) => signal.category === "negative"),
		tags,
	};
}
