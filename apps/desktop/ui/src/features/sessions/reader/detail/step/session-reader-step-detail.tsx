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
					"flex max-h-[calc(100cqh-var(--reader-top,var(--reader-inset))-var(--reader-inset))] flex-col gap-l @3xl/steps:h-[calc(100cqh-var(--reader-top,var(--reader-inset))-var(--reader-inset))]",
			)}
		>
			{top ? (
				<div className="shrink-0 corner-m bg-card px-m pt-m pb-s shadow-card corner-squircle squircle:corner-xl">
					{top}
				</div>
			) : null}
			<div
				ref={panelRef}
				className={cn(
					"flex flex-col overflow-hidden",
					!bare &&
						"corner-m bg-card shadow-card corner-squircle squircle:corner-xl",
					fit
						? "min-h-0 flex-1"
						: top
							? "min-h-0 @3xl/steps:flex-1"
							: "max-h-[calc(100cqh-2*var(--reader-inset))] @3xl/steps:h-[calc(100cqh-2*var(--reader-inset))]",
				)}
			>
				<div className="flex shrink-0 flex-col gap-m px-xxl pt-xl pb-l">
					<div className="flex items-center gap-xs text-body-m text-ink-3 tabular-nums">
						{shownId ? (
							<span title={shownId}>
								{agentId ? shortSubagentId(agentId) : shortStepId(shownId)}
							</span>
						) : null}
						<div className="ml-auto flex shrink-0 items-center gap-xs">
							{shownId ? <CopyButton value={shownId} title="Copy ID" /> : null}
							<StepHeadToggles
								expanded={expanded}
								onExpand={step ? onExpand : undefined}
								onRaw={() => setRawFor(raw ? null : selectionKey)}
								raw={raw}
							/>
						</div>
					</div>
					<div className="flex min-w-0 items-center gap-m text-body-xl font-medium">
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
								// design-escape-ok(opacity): no role renders this; decoration-ink/20
								className="truncate underline decoration-ink/20 underline-offset-4 transition-colors hover:decoration-ink"
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
								className="size-3.5 shrink-0 text-rose-mark"
							/>
						) : null}
					</div>
				</div>

				{skillHref ? (
					<div className="shrink-0 px-xxl pt-l pb-m">
						<Link
							to={skillHref}
							title="Open the skill"
							className={cn(
								"inline-flex items-center gap-xs",
								"corner-full py-xs pr-m pl-l",
								"text-body-m font-medium",
								"bg-card shadow-card transition-colors",
								"hover:bg-hover dark:bg-wash",
							)}
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
						"flex min-h-0 flex-1 flex-col gap-xl pt-xs",
						frozen
							? "overflow-hidden"
							: "scroll-fade overflow-y-auto *:shrink-0",
						frozen ? "pb-zero" : thinking ? "pb-xl" : "pb-xxl",
					)}
				>
					{raw ? (
						<PayloadSection label="Raw" show="text" value={rawValue} />
					) : (
						<>
							{step && withFields && !expanded && fields.length > 0 ? (
								<div
									className={cn(
										"grid shrink-0 grid-cols-2 gap-xl px-xxl",
										!shell &&
											(subagent || payloads.length > 0) &&
											"edge-b-m border-line-soft pb-xxl",
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
										"flex flex-col gap-l",
										frozen
											? "min-h-0 flex-1"
											: "edge-b-m border-line-soft pb-xxl",
									)}
								>
									{shell && !expanded ? (
										<div className="shrink-0 px-xxl empty:hidden">
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
										collapsible={!shell}
										command={shell?.full}
										model={waterfall.model}
										output={shell ? step.result : mcpOutput}
										wrapLines={!shell}
									/>
								</div>
							) : null}
							{step?.isError && step.result && step.kind !== "ci" && !carded ? (
								// design-escape-ok(opacity): no role renders this; bg-error/20
								<div className="mx-xxl flex flex-col gap-xs corner-m bg-error/20 px-l py-l text-body-xl text-error corner-squircle">
									<span className="flex items-center gap-s font-medium">
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
										"flex flex-col gap-xl",
										subagent &&
											payloads.length > 0 &&
											"edge-b-m border-line-soft pb-xxl",
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
											"edge-b-m border-line-soft pb-xxl",
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
