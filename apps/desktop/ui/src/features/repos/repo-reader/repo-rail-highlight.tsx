import type { RepositoryRunFigures } from "@rudel/api-routes";
import { IconX } from "@tabler/icons-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	DotFocusContext,
	DotFocusDaysContext,
	DotHighlightContext,
	DotLoadingContext,
	DotMarkContext,
} from "@/features/costs/cost-dot-chart";
import { metricFigure } from "@/features/costs/cost-format";
import {
	MetricBreakdownContext,
	MetricEmptyContext,
	MetricLoadingContext,
	MetricOverrideContext,
	RangeLeadContext,
} from "@/features/costs/cost-rail-override";
import type { Figure } from "@/lib/figure";
import {
	type RepoReaderTab,
	repoTabIcon,
	repoTabLabel,
} from "../repo-reader-tabs";

export type RailFigures = {
	[Key in keyof RepositoryRunFigures]: RepositoryRunFigures[Key] | null;
};

export type RailFilter = {
	days: ReadonlySet<string> | null;
	figures: RailFigures | null;
	name?: string;
	focus?: string;
	focusDays?: ReadonlySet<string>;
	loading?: boolean;
	onClear?: () => void;
};

const SetRailFilterContext = createContext<(filter: RailFilter | null) => void>(
	() => {},
);

function localDay(date: Date) {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function useToday() {
	const [today, setToday] = useState(() => localDay(new Date()));
	useEffect(() => {
		const timer = setInterval(() => setToday(localDay(new Date())), 60_000);
		return () => clearInterval(timer);
	}, []);
	return today;
}

const UNKNOWN = "—";

function emptyOf(figures: RailFigures): ReadonlySet<string> {
	const values: Record<string, number | null> = {
		cost: figures.cost,
		sessions: figures.sessions,
		agentRuns: figures.agentRuns,
		signals: figures.signals,
		mergedPullRequests: figures.mergedPullRequests,
		ciRuns: figures.ciRuns,
	};
	return new Set(
		Object.entries(values)
			.filter(([, value]) => value === 0 || value === null)
			.map(([key]) => key),
	);
}

function overridesOf(figures: RailFigures) {
	const shown = (
		value: number | null,
		metric: Parameters<typeof metricFigure>[1],
	) => (value === null ? [UNKNOWN] : metricFigure(value, metric));
	return new Map<string, Figure>([
		["cost", shown(figures.cost, "cost")],
		["sessions", shown(figures.sessions, "sessions")],
		["agentRuns", shown(figures.agentRuns, "agentRuns")],
		["signals", shown(figures.signals, "signals")],
		[
			"mergedPullRequests",
			shown(figures.mergedPullRequests, "mergedPullRequests"),
		],
		["ciRuns", shown(figures.ciRuns, "ciRuns")],
	]);
}

export function RailHighlightProvider({
	children,
	tab,
}: {
	children: ReactNode;
	tab: RepoReaderTab;
}) {
	const [filter, setFilter] = useState<RailFilter | null>(null);
	const today = useToday();
	const overrides = useMemo(
		() => (filter?.figures ? overridesOf(filter.figures) : null),
		[filter?.figures],
	);
	const empty = useMemo(
		() => (filter?.figures ? emptyOf(filter.figures) : null),
		[filter?.figures],
	);
	const loading = filter?.loading ?? false;
	const onClear = filter?.onClear;
	const name = filter?.name ?? repoTabLabel(tab);
	const TabIcon = repoTabIcon(onClear && tab === "summary" ? "sessions" : tab);
	const swap =
		"[grid-area:1/1] size-3.5 transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none";
	const lead = onClear ? (
		<span
			title={name}
			className="group/tag inline-flex h-8 min-w-0 items-center gap-xs corner-full bg-card pr-l pl-s text-body-m font-medium text-ink shadow-(--shadow-control)"
		>
			<button
				type="button"
				aria-label={`Stop filtering by ${name}`}
				onClick={onClear}
				className="grid size-5 shrink-0 place-items-center corner-full outline-none"
			>
				{TabIcon ? (
					<TabIcon
						aria-hidden="true"
						className={`${swap} group-hover/tag:scale-50 group-hover/tag:opacity-0 group-has-focus-visible/tag:scale-50 group-has-focus-visible/tag:opacity-0`}
					/>
				) : null}
				<IconX
					aria-hidden="true"
					className={`${swap} scale-50 text-ink-3 opacity-0 group-hover/tag:scale-100 group-hover/tag:opacity-100 group-has-focus-visible/tag:scale-100 group-has-focus-visible/tag:opacity-100 hover:text-ink`}
				/>
			</button>
			<span className="min-w-0 truncate">{name}</span>
		</span>
	) : null;
	return (
		<SetRailFilterContext.Provider value={setFilter}>
			<DotHighlightContext.Provider value={filter?.days ?? null}>
				<DotMarkContext.Provider value={today}>
					<DotFocusContext.Provider value={filter?.focus ?? null}>
						<DotFocusDaysContext.Provider value={filter?.focusDays ?? null}>
							<MetricOverrideContext.Provider value={overrides}>
								<MetricBreakdownContext.Provider
									value={
										filter?.figures
											? (filter.figures.breakdowns ?? null)
											: undefined
									}
								>
									<MetricLoadingContext.Provider value={loading}>
										<DotLoadingContext.Provider value={loading}>
											<MetricEmptyContext.Provider value={empty}>
												<RangeLeadContext.Provider value={lead}>
													{children}
												</RangeLeadContext.Provider>
											</MetricEmptyContext.Provider>
										</DotLoadingContext.Provider>
									</MetricLoadingContext.Provider>
								</MetricBreakdownContext.Provider>
							</MetricOverrideContext.Provider>
						</DotFocusDaysContext.Provider>
					</DotFocusContext.Provider>
				</DotMarkContext.Provider>
			</DotHighlightContext.Provider>
		</SetRailFilterContext.Provider>
	);
}

export function useRailFilter(filter: RailFilter | null) {
	const setFilter = useContext(SetRailFilterContext);
	useEffect(() => {
		setFilter(filter);
		return () => setFilter(null);
	}, [filter, setFilter]);
}
