import { getRawToolInput } from "@rudel/api-routes";
import {
	IconAlertTriangleFilled,
	IconArrowUpRight,
	IconRoute,
} from "@tabler/icons-react";
import { type ReactNode, useContext, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
	ConversationSkillLinkContext,
	ConversationSkillTurnContext,
} from "@/components/conversation/conversation-skill-link";
import { shortStepId, shortSubagentId } from "@/features/sessions/run-id";
import { CopyButton } from "@/features/shell/components/copy-button";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { cn } from "@/lib/utils";
import { mcpResult, mcpTool } from "../../model/session-reader-mcp-tool";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../../model/session-reader-model";
import { LANE_LOOK } from "../../model/session-reader-step-lanes";
import { subagentIdOf } from "../../subagents/session-reader-agent-focus";
import { useSubagentModels } from "../../subagents/session-reader-subagent-marks";
import { RunOverview } from "../session-reader-run-overview";
import { useContainedWheel } from "../use-stuck-card";
import {
	OpalChip,
	StepIconChip,
} from "../waterfall/session-reader-waterfall-chips";
import { CommandLines } from "./session-reader-command-steps";
import { McpCall } from "./session-reader-mcp-call";
import { Field, stepFields } from "./session-reader-step-fields";
import { StepHeadToggles } from "./session-reader-step-head-toggles";
import { PayloadSection } from "./session-reader-step-payload";
import { stepPayloads } from "./session-reader-step-payload-list";
import {
	EditDiff,
	ShellCallFields,
	ShellCommandBlock,
	shellCommandParts,
} from "./session-reader-step-payloads";
import { StepPlaces } from "./session-reader-step-places";
import { ToolCard } from "./session-reader-tool-card";

export function SessionReaderStepDetail({
	bare = false,
	expanded = false,
	fields: withFields = true,
	fit = false,
	onExpand,
	run,
	step,
	top,
	waterfall,
}: {
	bare?: boolean;
	expanded?: boolean;
	onExpand?: (expanded: boolean) => void;
	fields?: boolean;
	fit?: boolean;
	run: Omit<Parameters<typeof RunOverview>[0], "waterfall">;
	step: SessionReaderStep | null;
	top?: ReactNode;
	waterfall: SessionReaderWaterfall;
}) {
	const [rawFor, setRawFor] = useState<string | null>(null);
	const selectionKey = step?.id ?? "turn";
	const raw = rawFor === selectionKey;
	const rawValue = useMemo(
		() => JSON.stringify(step ?? waterfall, null, 2),
		[step, waterfall],
	);
	const reportFrom =
		step?.harness === "notification" && step.notification?.agent
			? step.notification.taskId
			: null;
	const launch =
		step?.kind === "agent"
			? step
			: reportFrom
				? waterfall.allSteps.find(
						(candidate) => subagentIdOf(candidate) === reportFrom,
					)
				: undefined;
	const subagent =
		launch && launch.kind !== "ci" && launch.children.length > 0
			? launch
			: undefined;
	const shell = step?.toolEvent ? shellCommandParts(step.toolEvent) : null;
	const description = step?.toolEvent
		? getRawToolInput(step.toolEvent.input).description
		: undefined;
	// Codex writes no description of its shell calls; theirs read "Bash" for
	// now.
	const mcp =
		step?.toolEvent && !shell ? mcpTool(step.toolEvent.toolName) : null;
	const carded = shell !== null || mcp !== null;
	const mcpOutput = useMemo(
		() =>
			step?.toolEvent && mcpTool(step.toolEvent.toolName)
				? mcpResult(step.result)
				: null,
		[step],
	);
	const thinking = step?.kind === "thinking" && Boolean(step.text);
	const banded = carded || thinking;
	const heading = shell
		? typeof description === "string" && description.trim()
			? description
			: "Bash"
		: (mcp?.tool ?? null);
	const models = useSubagentModels();
	const fields = step
		? stepFields(step, waterfall, carded, (launch) => {
				const id = subagentIdOf(launch);
				return id ? (models.get(id) ?? null) : null;
			})
		: [];
	const written = step?.writes
		? waterfall.allSteps.find((candidate) => candidate.id === step.writes)
		: undefined;
	const payloads = step ? stepPayloads(step, banded, waterfall, written) : [];
	const isTool = step?.kind === "agent" || step?.kind === "tool";
	const agentId = (step ? subagentIdOf(step) : null) ?? reportFrom;
	const shownId =
		agentId ??
		step?.nativeId ??
		(step?.harness === "notification" ? step.notification?.taskId : null) ??
		step?.id ??
		null;
	const frozen = carded && !raw && payloads.length === 0;
	const getSkillHref = useContext(ConversationSkillLinkContext);
	const skillTurnId = useContext(ConversationSkillTurnContext);
	const skillHref =
		step?.skill && getSkillHref ? getSkillHref(step.skill, skillTurnId) : null;
	const panelRef = useContainedWheel();
	const bodyFade = useScrollFade<HTMLDivElement>();

	return (
		<aside
			className={cn(
				fit
					? "flex min-h-0 w-full flex-1 flex-col"
					: "sticky top-(--reader-top,var(--reader-inset)) w-full shrink-0 self-start @3xl/steps:w-(--reader-card)",
				top &&
					!fit &&
					"flex max-h-[calc(100cqh-var(--reader-top,var(--reader-inset))-var(--reader-inset))] flex-col gap-3 @3xl/steps:h-[calc(100cqh-var(--reader-top,var(--reader-inset))-var(--reader-inset))]",
			)}
		>
			{top ? (
				<div className="shrink-0 rounded-lg bg-card px-2 pt-2 pb-1.5 shadow-(--custom-shadow) corner-squircle squircle:rounded-3xl">
					{top}
				</div>
			) : null}
			<div
				ref={panelRef}
				className={cn(
					"flex flex-col overflow-hidden",
					!bare &&
						"rounded-lg bg-card shadow-(--custom-shadow) corner-squircle squircle:rounded-3xl",
					fit
						? "min-h-0 flex-1"
						: top
							? "min-h-0 @3xl/steps:flex-1"
							: "max-h-[calc(100cqh-2*var(--reader-inset))] @3xl/steps:h-[calc(100cqh-2*var(--reader-inset))]",
				)}
			>
				<div className="flex shrink-0 flex-col gap-2 px-5 pt-4 pb-3">
					<div className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
						{shownId ? (
							<span title={shownId}>
								{agentId ? shortSubagentId(agentId) : shortStepId(shownId)}
							</span>
						) : null}
						<div className="ml-auto flex shrink-0 items-center gap-1">
							{shownId ? <CopyButton value={shownId} title="Copy ID" /> : null}
							<StepHeadToggles
								expanded={expanded}
								onExpand={step ? onExpand : undefined}
								onRaw={() => setRawFor(raw ? null : selectionKey)}
								raw={raw}
							/>
						</div>
					</div>
					<div className="flex min-w-0 items-center gap-2 text-sm font-medium">
						{step ? (
							<StepIconChip step={step} />
						) : (
							<OpalChip sidebar="active">
								<IconRoute aria-hidden="true" className="size-3" />
							</OpalChip>
						)}
						{skillHref && step?.toolEvent?.skillContent ? (
							<Link
								to={skillHref}
								className="truncate underline decoration-foreground/20 underline-offset-4 transition-colors hover:decoration-foreground"
							>
								{step?.name}
							</Link>
						) : (
							<span
								className={heading ? "line-clamp-2" : "truncate"}
								title={step?.command?.chain}
							>
								{heading ??
									step?.command?.chain ??
									step?.name ??
									"Reasoning Trace"}
							</span>
						)}
						{isTool && step?.kind !== "agent" && step?.isError ? (
							<IconAlertTriangleFilled
								aria-label="Failed"
								className="size-3.5 shrink-0 text-rose-500"
							/>
						) : null}
					</div>
				</div>

				{skillHref ? (
					<div className="shrink-0 px-5 pt-3 pb-2">
						<Link
							to={skillHref}
							title="Open the skill"
							className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-card py-1 pr-2 pl-2.5 text-xs font-medium shadow-(--custom-shadow) transition-colors hover:bg-muted dark:bg-muted-foreground/10"
						>
							Open details
							<IconArrowUpRight
								aria-hidden="true"
								className="size-3.5"
								style={{ color: LANE_LOOK.skill.tint }}
							/>
						</Link>
					</div>
				) : null}

				{step ? <StepPlaces agentId={agentId} step={step} /> : null}

				<div
					ref={bodyFade.ref}
					{...bodyFade.fade}
					className={cn(
						"flex min-h-0 flex-1 flex-col gap-4 pt-1",
						frozen
							? "overflow-hidden"
							: "scroll-fade overflow-y-auto *:shrink-0",
						frozen ? "pb-0" : thinking ? "pb-4" : "pb-5",
					)}
				>
					{raw ? (
						<PayloadSection label="Raw" show="text" value={rawValue} />
					) : (
						<>
							{step && withFields && !expanded && fields.length > 0 ? (
								<div
									className={cn(
										"grid shrink-0 grid-cols-2 gap-4 px-5",
										!shell &&
											(subagent || payloads.length > 0) &&
											"border-b border-border/40 pb-5",
									)}
								>
									{fields.map((field) => (
										<Field key={field.label} {...field} />
									))}
								</div>
							) : null}
							{thinking && step ? (
								<ToolCard fit output={step.text} prose scrolls={false} />
							) : null}
							{carded && step?.toolEvent ? (
								<div
									className={cn(
										"flex flex-col gap-3",
										frozen
											? "min-h-0 flex-1"
											: "border-b border-border/40 pb-5",
									)}
								>
									{shell && !expanded ? (
										<div className="shrink-0 px-5 empty:hidden">
											<ShellCallFields event={step.toolEvent} />
										</div>
									) : null}
									<ToolCard
										call={
											shell ? (
												<CommandLines
													key={shell.full}
													command={shell.full}
													fallback={
														<ShellCommandBlock event={step.toolEvent} />
													}
													renderEdit={(edit) => <EditDiff edit={edit} />}
												/>
											) : (
												<McpCall event={step.toolEvent} />
											)
										}
										command={shell?.full}
										output={shell ? step.result : mcpOutput}
									/>
								</div>
							) : null}
							{step?.isError && step.result && step.kind !== "ci" && !carded ? (
								<div className="mx-5 flex flex-col gap-1 rounded-lg bg-destructive/20 px-3 py-2.5 text-sm text-destructive corner-squircle">
									<span className="flex items-center gap-1.5 font-medium">
										<IconAlertTriangleFilled className="size-3.5 shrink-0" />
										Error
									</span>
									<span className="line-clamp-6 min-w-0 [overflow-wrap:anywhere]">
										{step.result}
									</span>
								</div>
							) : null}
							{!step || subagent ? (
								<div
									className={cn(
										"flex flex-col gap-4",
										subagent &&
											payloads.length > 0 &&
											"border-b border-border/40 pb-5",
									)}
								>
									<RunOverview
										{...run}
										scope={subagent}
										waterfall={waterfall}
									/>
								</div>
							) : null}
							{payloads.map((payload, index) => (
								<PayloadSection
									key={`${selectionKey}:${payload.label}`}
									className={cn(
										index < payloads.length - 1 &&
											"border-b border-border/40 pb-5",
									)}
									{...payload}
								/>
							))}
						</>
					)}
				</div>
			</div>
		</aside>
	);
}

export type SessionReaderStepSelection = Pick<
	Parameters<typeof SessionReaderStepDetail>[0],
	"run" | "step" | "waterfall"
>;
