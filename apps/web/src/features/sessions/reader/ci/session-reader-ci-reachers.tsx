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
		<span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
			<span className="w-5 text-muted-foreground/70">{index + 1}</span>
			<span className="font-mono text-muted-foreground">
				{shortRunId(turnId)}
			</span>
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
				"shrink-0 text-[11px] whitespace-nowrap",
				exact ? "text-foreground/70" : "text-muted-foreground italic",
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
	"flex min-h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors hover:bg-muted/60";

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
		<div className="flex min-w-0 flex-col pl-6">
			<span className="text-[11px] text-muted-foreground">
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
									main && lit === main.reacher.key && "bg-muted",
								)}
							>
								<TurnTag index={first.index} turnId={turn.turnId} />
								<span
									className={cn(
										"min-w-0 flex-1 truncate",
										main ? "text-foreground/85" : "text-muted-foreground",
									)}
								>
									{first.prompt ?? "No prompt"}
								</span>
								{main ? (
									<HowWords link={main.link} />
								) : (
									<span className="shrink-0 text-[11px] text-muted-foreground">
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
									className={cn(ROW, "pl-8", lit === reacher.key && "bg-muted")}
								>
									<SubagentTag
										subagentId={reacher.agent ?? ""}
										selected={lit === reacher.key}
									/>
									<span className="min-w-0 flex-1 truncate text-foreground/80">
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
		<div className="flex min-w-0 flex-col gap-0.5 pt-1">
			<span
				className="text-[11px] text-muted-foreground"
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
							className={cn(ROW, "-mx-1.5 w-[calc(100%+0.75rem)]")}
						>
							<TurnTag index={reacher.index} turnId={reacher.turnId} />
							{reacher.agent ? (
								<SubagentTag subagentId={reacher.agent} />
							) : null}
							<span className="min-w-0 flex-1 truncate text-foreground/80">
								{reacher.agent
									? (reacher.task ?? "Subagent")
									: (reacher.prompt ?? "No prompt")}
							</span>
							<span className="shrink-0 text-[11px] text-muted-foreground">
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
					className="w-fit cursor-pointer text-[11px] text-muted-foreground tabular-nums hover:text-foreground"
				>
					{open ? "Fewer" : `${rest} more`}
				</button>
			) : null}
		</div>
	);
}
