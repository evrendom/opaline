import { useState } from "react";
import { shortRunId, shortSubagentId } from "@/features/sessions/run-id";
import { cn } from "@/lib/utils";
import { SubagentTag } from "../subagents/session-reader-subagent-chip";
import type { OpenPlace } from "../summary/session-reader-summary-sections";
import {
	type CiReacher,
	type CiReachLink,
	type CiReachOf,
	type PullToucher,
	reachWords,
} from "./session-reader-ci-reach";

function TurnTag({ index, turnId }: { index: number; turnId: string }) {
	return (
		<span className="flex shrink-0 items-baseline gap-s tabular-nums">
			{/* design-escape-ok(opacity): shipped value; muted-foreground/70 */}
			<span className="w-5 text-ink-3/70">{index + 1}</span>
			<span className="font-mono text-ink-3">{shortRunId(turnId)}</span>
		</span>
	);
}

function HowWords({ link }: { link: CiReachLink }) {
	const words = reachWords(link);
	const exact = link.link === "exact";
	return (
		<span
			title={words.full}
			className={cn(
				"shrink-0 text-body-s whitespace-nowrap",
				// design-escape-ok(opacity): no role renders this; text-ink/70
				exact ? "text-ink/70" : "text-ink-3 italic",
			)}
		>
			<span className={cn(exact && "font-medium")}>
				{exact ? "Exact" : "Inferred"}
			</span>{" "}
			· {words.short}
		</span>
	);
}

const ROW =
	"flex min-h-6 w-full min-w-0 items-center gap-m corner-s px-s text-left text-body-m transition-colors hover:bg-hover";

export function ReachedBy({
	lit = null,
	onOpenTurn,
	reach,
}: {
	lit?: string | null;
	onOpenTurn: OpenPlace;
	reach: readonly CiReachOf[];
}) {
	if (reach.length === 0) return null;
	const turns: { reach: CiReachOf[]; turnId: string }[] = [];
	for (const each of reach) {
		const last = turns.at(-1);
		if (last?.turnId === each.reacher.turnId) last.reach.push(each);
		else turns.push({ reach: [each], turnId: each.reacher.turnId });
	}
	return (
		<div className="flex min-w-0 flex-col pl-xxl">
			<span className="text-body-s text-ink-3">
				Reached by {reach.length} {reach.length === 1 ? "run" : "runs"}
			</span>
			<ul className="flex min-w-0 flex-col">
				{turns.map((turn) => {
					const main = turn.reach.find((each) => !each.reacher.agent);
					const first = turn.reach[0]?.reacher as CiReacher;
					const subagents = turn.reach.filter((each) => each.reacher.agent);
					return (
						<li key={turn.turnId} className="flex min-w-0 flex-col">
							<button
								type="button"
								title={`Open turn ${first.index + 1} in the detail`}
								onClick={() => onOpenTurn(turn.turnId)}
								className={cn(
									ROW,
									main && lit === main.reacher.key && "bg-field",
								)}
							>
								<TurnTag index={first.index} turnId={turn.turnId} />
								<span
									className={cn(
										"min-w-0 flex-1 truncate",
										// design-escape-ok(opacity): no role renders this; text-ink/85
										main ? "text-ink/85" : "text-ink-3",
									)}
								>
									{first.prompt ?? "No prompt"}
								</span>
								{main ? (
									<HowWords link={main.link} />
								) : (
									<span className="shrink-0 text-body-s text-ink-3">
										through its{" "}
										{subagents.length === 1 ? "subagent" : "subagents"}
									</span>
								)}
							</button>
							{subagents.map(({ link, reacher }) => (
								<button
									key={reacher.key}
									type="button"
									title={`Open subagent ${shortSubagentId(reacher.agent ?? "")} in the detail`}
									onClick={() =>
										onOpenTurn(reacher.turnId, reacher.agent ?? undefined)
									}
									className={cn(
										ROW,
										"pl-[calc(var(--space-xxl)*4/3)]",
										lit === reacher.key && "bg-field",
									)}
								>
									<SubagentTag
										subagentId={reacher.agent ?? ""}
										selected={lit === reacher.key}
									/>
									{/* design-escape-ok(opacity): no role renders this; text-ink/80 */}
									<span className="min-w-0 flex-1 truncate text-ink/80">
										{reacher.task ?? "Subagent"}
									</span>
									<HowWords link={link} />
								</button>
							))}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

const TOUCHERS_SHOWN = 6;

export function PullTouchers({
	onOpenTurn,
	touchers,
}: {
	onOpenTurn: OpenPlace;
	touchers: readonly PullToucher[];
}) {
	const [open, setOpen] = useState(false);
	if (touchers.length === 0) return null;
	const shown = open ? touchers : touchers.slice(0, TOUCHERS_SHOWN);
	const rest = touchers.length - shown.length;
	return (
		<div className="flex min-w-0 flex-col gap-xxs pt-xs">
			<span
				className="text-body-s text-ink-3"
				title="Only runs that reached its CI: Opaline ties a pull request to a run through the CI it ran."
			>
				{touchers.length} {touchers.length === 1 ? "run" : "runs"} reached its
				CI
			</span>
			<ul className="flex min-w-0 flex-col">
				{shown.map(({ reacher, ways }) => (
					<li key={reacher.key}>
						<button
							type="button"
							onClick={() =>
								onOpenTurn(reacher.turnId, reacher.agent ?? undefined)
							}
							className={cn(ROW, "-mx-s w-[calc(100%+0.75rem)]")}
						>
							<TurnTag index={reacher.index} turnId={reacher.turnId} />
							{reacher.agent ? (
								<SubagentTag subagentId={reacher.agent} />
							) : null}
							{/* design-escape-ok(opacity): no role renders this; text-ink/80 */}
							<span className="min-w-0 flex-1 truncate text-ink/80">
								{reacher.agent
									? (reacher.task ?? "Subagent")
									: (reacher.prompt ?? "No prompt")}
							</span>
							<span className="shrink-0 text-body-s text-ink-3">
								{ways.join(", ") || "ran while its CI did"}
							</span>
						</button>
					</li>
				))}
			</ul>
			{rest > 0 || open ? (
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="w-fit text-body-s text-ink-3 tabular-nums hover:text-ink"
				>
					{open ? "Fewer" : `${rest} more`}
				</button>
			) : null}
		</div>
	);
}
