import { IconDevices, IconGitBranch, IconMessages } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { Reveal } from "@/app/ui/bones";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import { getModelBadgeTone } from "@/features/dashboard/components/dashboard-model-brand";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { BreakdownEmpty } from "../breakdown-empty";
import { SERIES_COLORS } from "../chart-colors";
import { ScrollFade } from "../cost-breakdown";
import { costLabel } from "../cost-format";
import { formatPoints } from "./plan-usage-chart";
import type { UsageWindow } from "./use-plan-usage";

interface Row {
	readonly id: string;
	readonly label: string;
	readonly icon: ReactNode;
	readonly points: number;
	readonly href?: string;
	readonly muted?: boolean;
}

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

const SAMPLE_ROWS: readonly Row[] = [
	{ id: "a", label: "Sample session title", icon: null, points: 30 },
	{ id: "b", label: "Another sample", icon: null, points: 18 },
	{ id: "c", label: "Sample", icon: null, points: 9 },
];

export function UsageBreakdowns({
	pending,
	window,
	titles,
}: {
	pending: boolean;
	window: UsageWindow | null;
	titles: Readonly<Record<string, string>>;
}) {
	const shellPath = useShellRoutePath();
	const heading = window
		? `Of ${window.label.toLowerCase()} limit`
		: "Of the limit";
	const sessions: Row[] = (window?.sessions ?? []).map((session) => ({
		id: session.sessionId,
		label: titles[session.sessionId] ?? session.sessionId.slice(0, 8),
		icon: <IconMessages size={14} className="shrink-0" />,
		points: session.points,
		href: shellPath(appRoutes.sessionDetail(session.sessionId)),
	}));
	if (window && window.otherPoints > 0)
		sessions.push({
			id: "other",
			label: "Not from this Mac",
			icon: <IconDevices size={14} className="shrink-0" />,
			points: window.otherPoints,
			muted: true,
		});
	return (
		<>
			<UsageBreakdown
				title="Sessions"
				heading={heading}
				pending={pending}
				rows={sessions}
			/>
			<UsageBreakdown
				title="Repositories"
				heading={heading}
				pending={pending}
				rows={(window?.repositories ?? []).map((entry) => ({
					id: entry.id || "none",
					label: repositoryLabel(entry.id),
					icon: <IconGitBranch size={14} className="shrink-0" />,
					points: entry.points,
				}))}
			/>
			<UsageBreakdown
				title="Models"
				heading={heading}
				pending={pending}
				rows={(window?.models ?? []).map((entry) => ({
					id: entry.id,
					label: costLabel("models", entry.id),
					icon: <ModelIcon id={entry.id} />,
					points: entry.points,
				}))}
			/>
		</>
	);
}

function UsageBreakdown({
	title,
	heading,
	pending,
	rows,
}: {
	title: string;
	heading: string;
	pending: boolean;
	rows: readonly Row[];
}) {
	const maximum = Math.max(0, ...rows.map((row) => row.points));
	return (
		<section
			className="cost-breakdown"
			data-empty={(!pending && rows.length === 0) || undefined}
			aria-label={title}
			aria-busy={pending}
		>
			<div className="cost-breakdown-heading">
				<h2>{title}</h2>
				<div>{heading}</div>
			</div>
			<ScrollFade
				className="cost-breakdown-list"
				data-many={(!pending && rows.length > 4) || undefined}
				data-empty={(!pending && rows.length === 0) || undefined}
			>
				{!pending && rows.length === 0 ? (
					<BreakdownEmpty title="No use" />
				) : (
					<Reveal
						label={`Loading ${title.toLowerCase()}`}
						loading={pending}
						sample={<UsageSample />}
						sampleId={`usage-breakdown-${title}`}
					>
						{() => (
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
					</Reveal>
				)}
			</ScrollFade>
		</section>
	);
}

function UsageSample() {
	const maximum = SAMPLE_ROWS[0]?.points ?? 1;
	return SAMPLE_ROWS.map((row, index) => (
		<UsageRow
			key={row.id}
			row={{ ...row, icon: <IconMessages size={14} className="shrink-0" /> }}
			maximum={maximum}
			color={SERIES_COLORS[index] ?? SERIES_COLORS[0]}
		/>
	));
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
				{share}
				<span className="cost-row-meter" aria-hidden="true">
					<span
						style={{
							width: `${Math.max(2, maximum > 0 ? (row.points / maximum) * 100 : 0)}%`,
							backgroundColor: color,
						}}
					/>
				</span>
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
