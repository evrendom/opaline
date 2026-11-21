import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { pullRequestUrl } from "@/features/sessions/reader/ci/session-reader-run-ci";
import { CARD } from "@/features/sessions/reader/files/session-reader-files-parts";
import { pullRequestLook } from "@/features/sessions/reader/summary/session-reader-summary-github";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { cn } from "@/lib/utils";
import { OUTCOME_TONE, type RepoPull } from "./repo-ci-model";
import { type RepoSession, useRepoData } from "./repo-page-data";

export { CARD };

export function money(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "$0";
	if (value < 1) return "<$1";
	if (value < 100) return `$${value.toFixed(value < 10 ? 1 : 0)}`;
	return `$${Math.round(value).toLocaleString("en-US")}`;
}

export const pct = (value: number) =>
	`${Math.round(Number.isFinite(value) ? value * 100 : 0)}%`;

export const plural = (count: number, word: string, many = `${word}s`) =>
	`${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;

export const modelLabel = (model: string) =>
	formatModelDisplayLabel(model) || model;

export const shortId = (id: string) => id.slice(0, 8);

export const sessionAt = (session: RepoSession) =>
	Date.parse(session.session_date);

export const struggleOf = (session: RepoSession) =>
	session.member_swears * 3 +
	session.model_apologies * 2 +
	(session.error_count ?? 0) / 5;

export const hasFriction = (session: RepoSession) =>
	session.member_swears > 0 || session.model_apologies > 0;

export const dayKey = (time: number) =>
	Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : "";

export function dayWords(key: string): string {
	const date = new Date(`${key}T12:00:00Z`);
	return date.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

export function rangeDays(startDate: string, endDate: string): string[] {
	const out: string[] = [];
	for (
		let time = Date.parse(`${startDate}T00:00:00Z`);
		time <= Date.parse(`${endDate}T00:00:00Z`);
		time += 86_400_000
	)
		out.push(dayKey(time));
	return out;
}

export function useSessionHref() {
	const getShellRoutePath = useShellRoutePath();
	const { repoKey } = useRepoData();
	return (sessionId: string) =>
		getShellRoutePath(appRoutes.repoDetail(repoKey, sessionId));
}

export function useSkillHref() {
	const getShellRoutePath = useShellRoutePath();
	const { repoKey } = useRepoData();
	return (name: string) =>
		`${getShellRoutePath(appRoutes.repoDetail(repoKey))}&tab=skills&skill=${encodeURIComponent(name)}`;
}

export function SessionLink({
	children,
	className,
	session,
}: {
	children?: ReactNode;
	className?: string;
	session: RepoSession;
}) {
	const href = useSessionHref();
	return (
		<Link
			to={href(session.session_id)}
			title={session.session_id}
			className={cn(
				"min-w-0 truncate text-ink-90 underline-offset-2 hover:text-ink hover:underline",
				className,
			)}
		>
			{children ?? shortId(session.session_id)}
		</Link>
	);
}

export function SkillLink({ name }: { name: string }) {
	const href = useSkillHref();
	return (
		<Link
			to={href(name)}
			className={cn(
				"inline-flex h-6 max-w-full items-center",
				"corner-full px-[calc(var(--space-m)+var(--space-xxs))]",
				"truncate text-body-s",
				"bg-card text-ink-90 shadow-control",
				"hover:text-ink",
			)}
		>
			{name}
		</Link>
	);
}

export function PullLink({
	className,
	pull,
	title = true,
}: {
	className?: string;
	pull: RepoPull;
	title?: boolean;
}) {
	const look = pullRequestLook({ ...pull.pull, relations: [] });
	const Glyph = look.icon;
	return (
		<a
			href={pullRequestUrl(pull.pull.repository, pull.pull.number)}
			target="_blank"
			rel="noreferrer"
			title={pull.pull.title ?? undefined}
			className={cn(
				"inline-flex min-w-0 items-center gap-s text-ink-90 hover:text-ink",
				className,
			)}
		>
			<Glyph
				aria-hidden="true"
				className={cn("size-3.5 shrink-0", look.className || "text-ink-3")}
			/>
			<span className="shrink-0 text-ink-3 tabular-nums">
				#{pull.pull.number}
			</span>
			{title ? (
				<span className="min-w-0 truncate">
					{pull.pull.title ?? "Not synced"}
				</span>
			) : null}
		</a>
	);
}

export function PushStrip({
	className,
	pull,
}: {
	className?: string;
	pull: RepoPull;
}) {
	if (pull.rounds.length === 0)
		return <span className="text-body-s text-ink-3">no CI</span>;
	return (
		<span
			className={cn("inline-flex items-center gap-xxs", className)}
			title={`${pull.rounds.length} pushes`}
		>
			{pull.rounds.slice(0, 14).map((round) => (
				<span
					key={round.sha}
					// design-escape-ok(radius): shipped value; 2px corner
					className={cn("size-2 rounded-[2px]", OUTCOME_TONE[round.outcome])}
				/>
			))}
			{pull.rounds.length > 14 ? (
				<span className="pl-xxs text-body-xs text-ink-3">
					+{pull.rounds.length - 14}
				</span>
			) : null}
		</span>
	);
}

const CHIP_TONE = {
	error: "bg-error-tint text-error",
	warning: "bg-warning-tint text-warning",
	muted: "bg-field text-ink-3",
} as const;

export type ChipTone = keyof typeof CHIP_TONE;

export function Chip({
	children,
	tone = "muted",
	title,
}: {
	children: ReactNode;
	tone?: ChipTone;
	title?: string;
}) {
	return (
		<span
			title={title}
			className={cn(
				"inline-flex h-5 shrink-0 items-center gap-xs",
				"corner-full px-m",
				"text-body-s font-medium whitespace-nowrap tabular-nums",
				CHIP_TONE[tone],
			)}
		>
			{children}
		</span>
	);
}

export function StruggleChips({
	apologies,
	errors,
	frustration,
}: {
	apologies: number;
	errors: number;
	frustration: number;
}) {
	return (
		<span className="inline-flex flex-wrap gap-xs">
			{frustration > 0 ? (
				<Chip tone="error" title="Member swore at the agent">
					{frustration} frustrated
				</Chip>
			) : null}
			{apologies > 0 ? (
				<Chip tone="warning" title="The model apologised">
					{apologies} apologies
				</Chip>
			) : null}
			{errors > 0 ? (
				<Chip tone="muted" title="Tool errors">
					{errors} errors
				</Chip>
			) : null}
		</span>
	);
}

export function Bars({
	className,
	highlight,
	labels,
	onPick,
	// design-escape-ok(opacity): no role renders this; ink/70
	tone = "bg-ink/70",
	values,
}: {
	className?: string;
	highlight?: number | null;
	labels?: readonly string[];
	onPick?: (index: number) => void;
	tone?: string;
	values: readonly number[];
}) {
	const max = Math.max(...values, 0);
	return (
		<div
			className={cn(
				"flex h-16 items-end gap-[calc(var(--space-xxs)*3/2)]",
				className,
			)}
		>
			{values
				.map((value, slot) => ({
					value,
					slot,
					id: labels?.[slot] ?? `slot-${slot}`,
				}))
				.map(({ value, slot: index, id }) => (
					<button
						key={id}
						type="button"
						title={labels?.[index]}
						onClick={onPick ? () => onPick(index) : undefined}
						className={cn(
							// design-escape-ok(radius): shipped value; 2px corner
							"min-w-0 flex-1 rounded-[2px] transition-opacity focus-outline",
							onPick ? "hover:opacity-100" : "cursor-default",
							highlight === undefined ||
								highlight === null ||
								highlight === index
								? "opacity-100"
								: "opacity-35",
							value > 0 ? tone : "bg-field",
						)}
						style={{
							height: `${max > 0 && value > 0 ? Math.max(6, (value / max) * 100) : 4}%`,
						}}
					/>
				))}
		</div>
	);
}

export function Avatar({ userId }: { userId: string }) {
	const { userAvatar, userName } = useRepoData();
	const src = userAvatar(userId);
	const name = userName(userId);
	return src ? (
		<img
			src={src}
			alt={name}
			title={name}
			className="size-5 shrink-0 corner-full object-cover"
		/>
	) : (
		<span
			title={name}
			className={cn(
				"flex size-5 shrink-0 items-center justify-center",
				"corner-full",
				"text-body-xs font-medium uppercase",
				"bg-field text-ink-3",
			)}
		>
			{name.slice(0, 1)}
		</span>
	);
}

export function Loading({ what }: { what: string }) {
	return (
		<div className="flex flex-col gap-l pt-m">
			<p className="text-body-m text-ink-3">Reading {what}…</p>
			{[72, 56, 64].map((width) => (
				<div
					key={width}
					className="h-4 animate-pulse corner-s bg-field"
					style={{ width: `${width}%` }}
				/>
			))}
		</div>
	);
}
