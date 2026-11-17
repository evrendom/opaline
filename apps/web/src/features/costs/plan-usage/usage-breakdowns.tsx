import { IconDevices, IconGitBranch, IconMessages } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import { getModelBadgeTone } from "@/features/dashboard/components/dashboard-model-brand";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { SERIES_COLORS } from "../chart-colors";
import { bucketDate, type ChartInterval } from "../chart-interval";
import { ScrollFade } from "../cost-breakdown";
import { costLabel } from "../cost-format";
import { useMarkedDate } from "../cost-hover-date";
import { RollingText } from "../cost-rolling-text";
import { formatPoints } from "./plan-usage-chart";
import type { UsageWindow } from "./use-plan-usage";

interface Row {
	readonly id: string;
	readonly label: string;
	readonly icon: ReactNode;
	readonly points: number;
	readonly cost: number | null;
	readonly estimated: boolean;
	readonly href?: string;
	readonly muted?: boolean;
}

const money = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

function repositoryLabel(id: string): string {
	return id
		? id
				.replace(/^(?:github\.com|gitlab\.com|bitbucket\.org)\//u, "")
				.replace(/\/$/u, "")
				.split("/")
				.slice(-2)
				.join("/")
		: "No repository";
}

function ModelIcon({ id }: { id: string }) {
	const tone = getModelBadgeTone(id);
	if (tone.icon === "claude")
		return <ClaudeModelIcon className="size-3.5 shrink-0" />;
	if (tone.icon === "codex")
		return <CodexModelIcon className="size-3.5 shrink-0" />;
	return (
		<span className="cost-unknown-model" aria-hidden="true">
			?
		</span>
	);
}

type Shares = Map<string, readonly [number, number]>;

function hoveredShares(
	window: UsageWindow,
	interval: ChartInterval,
	marked: string,
) {
	const sessions: Shares = new Map();
	const repositories: Shares = new Map();
	const models: Shares = new Map();
	let used = 0;
	const add = (
		target: Shares,
		shares: Readonly<Record<string, readonly [number, number]>> | undefined,
	) => {
		for (const [id, [points, cost]] of Object.entries(shares ?? {})) {
			const [sumPoints, sumCost] = target.get(id) ?? [0, 0];
			target.set(id, [sumPoints + points, sumCost + cost]);
		}
	};
	for (const bucket of window.buckets) {
		if (bucketDate(bucket.at.slice(0, 10), interval) !== marked) continue;
		used += bucket.usedPoints;
		add(sessions, bucket.groups?.sessions);
		add(repositories, bucket.groups?.repositories);
		add(models, bucket.groups?.models);
	}
	const local = [...sessions.values()].reduce(
		(sum, [points]) => sum + points,
		0,
	);
	return { sessions, repositories, models, other: Math.max(0, used - local) };
}

export function UsageBreakdowns({
	window,
	titles,
	interval,
}: {
	window: UsageWindow;
	titles: Readonly<Record<string, string>>;
	interval: ChartInterval;
}) {
	const shellPath = useShellRoutePath();
	const marked = useMarkedDate();
	const hovered = marked ? hoveredShares(window, interval, marked) : null;
	const at = (
		group: "sessions" | "repositories" | "models",
		id: string,
		points: number,
		cost: number,
	) => {
		if (!hovered) return { points, cost };
		const [sharePoints, shareCost] = hovered[group].get(id) ?? [0, 0];
		return { points: sharePoints, cost: shareCost };
	};
	const heading = `Of ${window.label.toLowerCase()} limit`;
	const sessions: Row[] = window.sessions.map((session) => ({
		id: session.sessionId,
		label: titles[session.sessionId] ?? session.sessionId.slice(0, 8),
		icon: <IconMessages size={14} className="shrink-0" />,
		...at("sessions", session.sessionId, session.points, session.cost),
		estimated: session.estimated,
		href: shellPath(appRoutes.sessionDetail(session.sessionId)),
	}));
	const otherPoints = hovered ? hovered.other : window.otherPoints;
	if (window.otherPoints > 0)
		sessions.push({
			id: "other",
			label: "Not from this Mac",
			icon: <IconDevices size={14} className="shrink-0" />,
			points: otherPoints,
			cost: null,
			estimated: false,
			muted: true,
		});
	return (
		<>
			<UsageBreakdown title="Sessions" heading={heading} rows={sessions} />
			<UsageBreakdown
				title="Repositories"
				heading={heading}
				rows={window.repositories.map((entry) => ({
					id: entry.id || "none",
					label: repositoryLabel(entry.id),
					icon: <IconGitBranch size={14} className="shrink-0" />,
					...at("repositories", entry.id, entry.points, entry.cost),
					estimated: entry.estimated,
				}))}
			/>
			<UsageBreakdown
				title="Models"
				heading={heading}
				rows={window.models.map((entry) => ({
					id: entry.id,
					label: costLabel("models", entry.id),
					icon: <ModelIcon id={entry.id} />,
					...at("models", entry.id, entry.points, entry.cost),
					estimated: entry.estimated,
				}))}
			/>
		</>
	);
}

function UsageBreakdown({
	title,
	heading,
	rows,
}: {
	title: string;
	heading: string;
	rows: readonly Row[];
}) {
	const maximum = Math.max(0, ...rows.map((row) => row.points));
	return (
		<section className="cost-breakdown" aria-label={title}>
			<div className="cost-breakdown-heading">
				<h2>{title}</h2>
				<div>{heading}</div>
			</div>
			<ScrollFade
				className="cost-breakdown-list"
				data-many={rows.length > 4 || undefined}
			>
				{rows.length === 0 ? (
					<p className="cost-breakdown-empty">
						Nothing used the limit in this period.
					</p>
				) : (
					<div data-fluid-menu-root="">
						<FluidMenuHover items=".cost-breakdown-row" />
						{rows.map((row, index) => (
							<UsageRow
								key={row.id}
								row={row}
								maximum={maximum}
								color={
									row.muted
										? "var(--cost-muted)"
										: (SERIES_COLORS[index % (SERIES_COLORS.length - 1)] ??
											SERIES_COLORS[0])
								}
							/>
						))}
					</div>
				)}
			</ScrollFade>
		</section>
	);
}

function UsageRow({
	row,
	maximum,
	color,
}: {
	row: Row;
	maximum: number;
	color: string;
}) {
	const share = formatPoints(row.points);
	const content = (
		<>
			<span className="cost-row-identity">
				{row.icon}
				<span className="truncate">{row.label}</span>
			</span>
			<span className="cost-row-amount">
				<RollingText text={share} />
				<span className="cost-row-meter" aria-hidden="true">
					<span
						style={{
							width: `${Math.max(2, maximum > 0 ? (row.points / maximum) * 100 : 0)}%`,
							backgroundColor: color,
						}}
					/>
				</span>
				{row.cost !== null ? (
					<small className="cost-cycle-time">
						<RollingText text={money.format(row.cost)} />
					</small>
				) : null}
			</span>
		</>
	);
	const title = `${row.label} · ${share}`;
	return row.href ? (
		<Link to={row.href} className="cost-breakdown-row" title={title}>
			{content}
		</Link>
	) : (
		<div
			className="cost-breakdown-row"
			title={title}
			data-muted={row.muted || undefined}
		>
			{content}
		</div>
	);
}
