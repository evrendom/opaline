import type {
	MomentObservation,
	NoticeableRun,
	RunFlag,
	RunRecord,
} from "@rudel/api-routes";
import {
	IconBulb,
	IconCircleXFilled,
	IconCornerDownRight,
	IconExternalLink,
	IconFileDiff,
	IconFileText,
	IconFold,
	IconMessage2,
	IconSparkles,
	IconTerminal2,
	IconUser,
	type Icon as TablerIcon,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { type CSSProperties, type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { formatReaderCost } from "@/features/sessions/reader/model/session-reader-model";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { client, orpc } from "@/lib/orpc";
import { ObservationCard } from "./compass-moments";
import { MOMENT_KINDS_APPEARANCE } from "./moment-labels";

/**
 * The right pane for one noticeable run: what it was asked, every flag and
 * what it saw, the observation (or the button that asks for one), and then
 * everything that went on in the run, record by record, with the records a
 * flag points at marked in its colour.
 */
export function RunPane({
	run: listed,
	range,
	observable,
	onObserved,
}: {
	run: NoticeableRun;
	range: { startDate: string; endDate: string };
	observable: boolean;
	onObserved: () => void;
}) {
	const { userMap } = useUserMap();
	const getShellRoutePath = useShellRoutePath();
	const { state: organization } = useOrganization();
	const organizationId = organization.activeOrg?.id;
	const options = orpc.analytics.moments.run.queryOptions({
		input: {
			userId: listed.userId,
			sessionId: listed.sessionId,
			agentId: listed.agentId,
			turn: listed.turn,
			startDate: range.startDate,
			endDate: range.endDate,
		},
	});
	const detail = useQuery({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled: !!organizationId,
		staleTime: 60_000,
	});
	const run = detail.data?.run ?? listed;
	const started = new Date(run.startedAt);
	return (
		<article className="compass-detail" aria-label="Run">
			<header className="compass-detail-header">
				<div className="compass-detail-eyebrow">
					<span>{userMap[run.userId] ?? "Member"}</span>
					<span aria-hidden="true">·</span>
					<span>
						{started.toLocaleDateString(undefined, {
							weekday: "short",
							month: "short",
							day: "numeric",
						})}{" "}
						{started.toLocaleTimeString(undefined, {
							hour: "2-digit",
							minute: "2-digit",
						})}
					</span>
				</div>
				<h2 className="compass-detail-title">
					{run.prompt ?? `Run ${run.turn}`}
				</h2>
				<div className="compass-detail-actions" data-fluid-menu-root="">
					<FluidMenuHover items="a" />
					<Link
						to={getShellRoutePath(appRoutes.sessionDetail(run.sessionId))}
						className="cost-text-button inline-flex items-center gap-1"
					>
						Open the session
						<IconExternalLink aria-hidden="true" className="size-3.5" />
					</Link>
				</div>
			</header>

			<dl className="compass-properties">
				<Property label="Run">
					{run.turn}
					{run.agentId ? " of a subagent" : ""}
				</Property>
				<Property label="Duration">
					{Math.max(1, Math.round(run.minutes))} min
				</Property>
				<Property label="Cost">{formatReaderCost(run.costUsd)}</Property>
				{run.model ? <Property label="Model">{run.model}</Property> : null}
			</dl>

			<section className="compass-detail-section" aria-label="Flags">
				<h3>Why it’s here</h3>
				<ul className="compass-flag-list">
					{run.flags.map((flag) => (
						<FlagItem key={flag.kind} flag={flag} />
					))}
				</ul>
			</section>

			<section className="compass-detail-section" aria-label="Observation">
				<h3>Observation</h3>
				<Observation
					key={run.id}
					run={run}
					range={range}
					observable={observable && (detail.data?.observable ?? true)}
					onObserved={onObserved}
				/>
			</section>

			<section className="compass-detail-section" aria-label="What went on">
				<h3>
					What went on
					{detail.data ? (
						<span className="compass-hint">
							{" "}
							· {detail.data.records.length.toLocaleString("en-US")}
							{detail.data.truncated ? "+" : ""} records
						</span>
					) : null}
				</h3>
				{detail.isPending ? (
					<TimelineSkeleton />
				) : detail.isError ? (
					<p className="compass-hint">{detail.error.message}</p>
				) : (
					<Timeline records={detail.data.records} flags={run.flags} />
				)}
				{detail.data?.truncated ? (
					<p className="compass-hint">
						The run goes on past these records.{" "}
						<Link
							to={getShellRoutePath(appRoutes.sessionDetail(run.sessionId))}
							className="underline"
						>
							Open the session
						</Link>{" "}
						to read the rest.
					</p>
				) : null}
			</section>
		</article>
	);
}

function Property({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{children}</dd>
		</div>
	);
}

/** A flag, with what it saw; clicking jumps to the first record it points at. */
function FlagItem({ flag }: { flag: RunFlag }) {
	const kind = MOMENT_KINDS_APPEARANCE[flag.kind];
	const Glyph = kind.icon;
	return (
		<li>
			<button
				type="button"
				className="compass-flag-item"
				style={{ "--glyph-color": kind.color } as CSSProperties}
				onClick={() =>
					document
						.getElementById(recordAnchor(flag.spanStart))
						?.scrollIntoView({ behavior: "smooth", block: "center" })
				}
			>
				<Glyph aria-hidden="true" className="compass-row-glyph" />
				<span className="font-medium">{kind.label}</span>
				<span className="compass-row-sub truncate">{flag.detail}</span>
				<span className="compass-flag-span">
					{flag.spanStart === flag.spanEnd
						? `#${flag.spanStart}`
						: `#${flag.spanStart}–${flag.spanEnd}`}
				</span>
			</button>
		</li>
	);
}

function Observation({
	run,
	range,
	observable,
	onObserved,
}: {
	run: NoticeableRun;
	range: { startDate: string; endDate: string };
	observable: boolean;
	onObserved: () => void;
}) {
	const [observation, setObservation] = useState<MomentObservation | null>(
		run.observation,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const observe = async () => {
		setBusy(true);
		setError(null);
		try {
			setObservation(
				await client.analytics.moments.observe({
					userId: run.userId,
					sessionId: run.sessionId,
					agentId: run.agentId,
					turn: run.turn,
					startDate: range.startDate,
					endDate: range.endDate,
				}),
			);
			onObserved();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};
	const shown = observation ?? run.observation;
	if (shown) return <ObservationCard observation={shown} />;
	if (!observable)
		return (
			<p className="compass-hint">
				Observations aren’t turned on for this workspace.
			</p>
		);
	return (
		<div className="flex flex-col items-start gap-1.5">
			<button
				type="button"
				className="cost-secondary-button inline-flex items-center gap-1.5"
				onClick={observe}
				disabled={busy}
			>
				<IconSparkles aria-hidden="true" className="size-4" />
				{busy ? "Reading the run…" : "Observe with Claude"}
			</button>
			<span className="compass-hint">
				Sends only this run’s flagged records to Anthropic. The note is kept for
				your workspace.
			</span>
			{error ? (
				<p role="alert" className="compass-error">
					{error}
				</p>
			) : null}
		</div>
	);
}

const recordAnchor = (record: number) => `compass-record-${record}`;

/**
 * Every record of the run in order. A flag that points at part of the run
 * marks its records with its colour, and the first of them says which flag
 * starts there; flags about the whole run (cost, duration) mark nothing.
 * Context added in a row folds into one line.
 */
function Timeline({
	records,
	flags,
}: {
	records: readonly RunRecord[];
	flags: readonly RunFlag[];
}) {
	const first = records[0]?.record;
	const last = records.at(-1)?.record;
	if (first === undefined || last === undefined)
		return <p className="compass-hint">No records are stored for this run.</p>;
	const pointed = flags.filter(
		(flag) => flag.spanStart > first || flag.spanEnd < last,
	);
	const items = records.map((record) => ({
		record,
		color: pointed.find(
			(flag) =>
				record.record >= flag.spanStart && record.record <= flag.spanEnd,
		),
		starting:
			record.block === 0
				? pointed.filter((flag) => flag.spanStart === record.record)
				: [],
	}));
	const seen = new Set<number>();
	const anchorOf = (record: RunRecord) => {
		if (seen.has(record.record)) return undefined;
		seen.add(record.record);
		return recordAnchor(record.record);
	};
	const rows: ReactNode[] = [];
	for (let index = 0; index < items.length; ) {
		const item = items[index];
		if (!item) break;
		let end = index + 1;
		if (item.record.kind === "injected_context")
			while (
				items[end]?.record.kind === "injected_context" &&
				items[end]?.starting.length === 0
			)
				end++;
		if (end - index > 1) {
			const group = items.slice(index, end);
			rows.push(
				<ContextGroup
					key={`${item.record.record}-${item.record.block}-group`}
					items={group.map((each) => ({
						...each,
						anchor: anchorOf(each.record),
					}))}
				/>,
			);
		} else
			rows.push(
				<TimelineItem
					key={`${item.record.record}-${item.record.block}`}
					record={item.record}
					anchor={anchorOf(item.record)}
					color={
						item.color
							? MOMENT_KINDS_APPEARANCE[item.color.kind].color
							: undefined
					}
					starting={item.starting}
				/>,
			);
		index = end;
	}
	return <ol className="compass-timeline">{rows}</ol>;
}

/** Context added several times in a row, as one line that opens to show each. */
function ContextGroup({
	items,
}: {
	items: readonly {
		record: RunRecord;
		color: RunFlag | undefined;
		starting: readonly RunFlag[];
		anchor: string | undefined;
	}[];
}) {
	const [open, setOpen] = useState(false);
	const head = items[0];
	if (!head) return null;
	const color = items.find((item) => item.color)?.color;
	if (open)
		return items.map((item) => (
			<TimelineItem
				key={`${item.record.record}-${item.record.block}`}
				record={item.record}
				anchor={item.anchor}
				color={
					item.color
						? MOMENT_KINDS_APPEARANCE[item.color.kind].color
						: undefined
				}
				starting={item.starting}
			/>
		));
	return (
		<li
			id={head.anchor}
			className="compass-timeline-item"
			data-kind="injected_context"
			data-flagged={color ? "" : undefined}
			style={
				color
					? ({
							"--flag-color": MOMENT_KINDS_APPEARANCE[color.kind].color,
						} as CSSProperties)
					: undefined
			}
		>
			{head.starting.length > 0 ? <FlagMarkers flags={head.starting} /> : null}
			<button
				type="button"
				className="compass-timeline-line compass-timeline-group"
				onClick={() => setOpen(true)}
			>
				<IconFileText aria-hidden="true" className="compass-timeline-icon" />
				<span className="compass-timeline-label">
					Context added {items.length} times
				</span>
				<span className="compass-timeline-meta">
					#{head.record.record}–{items.at(-1)?.record.record}
				</span>
			</button>
		</li>
	);
}

function FlagMarkers({ flags }: { flags: readonly RunFlag[] }) {
	return (
		<div className="compass-timeline-marker">
			{flags.map((flag) => {
				const kind = MOMENT_KINDS_APPEARANCE[flag.kind];
				const FlagGlyph = kind.icon;
				return (
					<span
						key={flag.kind}
						style={{ "--glyph-color": kind.color } as CSSProperties}
					>
						<FlagGlyph aria-hidden="true" className="compass-row-glyph" />
						{kind.label}: {flag.detail}
					</span>
				);
			})}
		</div>
	);
}

function TimelineItem({
	record,
	anchor,
	color,
	starting,
}: {
	record: RunRecord;
	anchor: string | undefined;
	color: string | undefined;
	starting: readonly RunFlag[];
}) {
	const [open, setOpen] = useState(false);
	const look = recordLook(record);
	const Glyph = look.icon;
	const cut = record.textChars > record.text.length;
	const long = record.text.length > 240 || record.text.includes("\n");
	return (
		<li
			id={anchor}
			className="compass-timeline-item"
			data-kind={record.kind}
			data-failed={record.failed || undefined}
			data-flagged={color ? "" : undefined}
			style={color ? ({ "--flag-color": color } as CSSProperties) : undefined}
		>
			{starting.length > 0 ? <FlagMarkers flags={starting} /> : null}
			<div className="compass-timeline-line">
				<Glyph aria-hidden="true" className="compass-timeline-icon" />
				<span className="compass-timeline-label">{look.label}</span>
				<span className="compass-timeline-meta">
					#{record.record}
					{record.at
						? ` · ${new Date(record.at).toLocaleTimeString(undefined, {
								hour: "2-digit",
								minute: "2-digit",
								second: "2-digit",
							})}`
						: ""}
				</span>
			</div>
			{record.text && record.kind !== "file_change" ? (
				<button
					type="button"
					className="compass-timeline-text"
					data-open={open || undefined}
					data-long={long || undefined}
					aria-expanded={long ? open : undefined}
					onClick={() => setOpen((value) => !value)}
				>
					{record.text}
					{open && cut
						? ` … ${(record.textChars - record.text.length).toLocaleString("en-US")} more characters in the session`
						: ""}
				</button>
			) : null}
		</li>
	);
}

/** How a record reads in the timeline: its glyph and a few words. */
function recordLook(record: RunRecord): { icon: TablerIcon; label: string } {
	switch (record.kind) {
		case "user_prompt":
			return {
				icon: IconUser,
				label:
					record.subtype === "delegation"
						? "Task handed over"
						: record.subtype === "queued"
							? "Prompt typed while it worked"
							: "Prompt",
			};
		case "assistant_text":
			return { icon: IconMessage2, label: "Agent" };
		case "reasoning":
			return { icon: IconBulb, label: "Thinking" };
		case "tool_call":
			return { icon: IconTerminal2, label: record.tool || "Tool call" };
		case "tool_result":
			return record.failed
				? {
						icon: IconCircleXFilled,
						label:
							record.exitCode !== null && record.exitCode !== 0
								? `Failed, exit ${record.exitCode}`
								: "Failed",
					}
				: {
						icon: IconCornerDownRight,
						label: record.subtype === "running" ? "Still running" : "Result",
					};
		case "file_change":
			return {
				icon: IconFileDiff,
				label: `${fileOpLabel(record.fileOp)} ${record.filePath}`,
			};
		case "compaction":
			return { icon: IconFold, label: "Context compacted" };
		case "injected_context":
			return { icon: IconFileText, label: "Context added" };
		default:
			return { icon: IconFileText, label: record.kind.replaceAll("_", " ") };
	}
}

function fileOpLabel(op: string): string {
	if (op === "write") return "Wrote";
	if (op === "edit") return "Edited";
	if (op === "delete") return "Deleted";
	if (op.startsWith("inferred_")) return "Maybe changed";
	return "Changed";
}

function TimelineSkeleton() {
	return (
		<div className="flex flex-col gap-3" aria-hidden="true">
			{[0, 1, 2, 3, 4, 5].map((index) => (
				<div key={index} className="flex flex-col gap-1.5">
					<div className="cost-skeleton h-3.5 w-40" />
					<div className="cost-skeleton h-3 w-full max-w-120" />
				</div>
			))}
		</div>
	);
}
