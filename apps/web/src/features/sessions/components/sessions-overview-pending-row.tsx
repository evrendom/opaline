import { IconAlertCircle, IconUser } from "@tabler/icons-react";
import { ConversationTraceTag } from "@/components/conversation/conversation-trace-tag";
import { cn } from "@/lib/utils";
import { SessionModelMark } from "./session-model-mark";
import {
	SESSION_OVERVIEW_CELL_CLASS_NAME,
	SESSION_OVERVIEW_METADATA_CLASS_NAME,
	SESSION_OVERVIEW_ROW_CLASS_NAME,
	SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
	SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME,
	SessionLanguageSignalTag,
} from "./session-overview-row-elements";
import { SessionOverviewSubagentStack } from "./session-overview-subagent-stack";
import { SESSION_OVERVIEW_GRID_CLASS_NAME } from "./sessions-overview-table-utils";

const PENDING_SKILL_WIDTHS = ["w-8", "w-14", "w-10", "w-16", "w-6", "w-12"];
// Cost varies independently of the rows' time order.
const PENDING_COST_VALUES = [
	8, 72, 19, 93, 4, 38, 12, 61, 26, 7, 84, 17, 47, 3, 31, 100,
];
// Positive/negative totals: zero leaves that category empty; extras use +N.
const PENDING_MEMBER_SIGNAL_COUNTS = [
	[2, 0],
	[0, 4],
	[1, 2],
	[0, 0],
	[4, 0],
	[0, 1],
	[2, 4],
	[1, 0],
	[0, 2],
	[4, 1],
	[0, 4],
	[2, 0],
];

// Pending rows share the dashboard's tracks, marks and badges. Only repository
// and source are known before upload; the remaining values stay placeholders.
export function SessionsOverviewPendingRow({
	index,
	repositoryName,
	source,
	placeholderOnly,
}: {
	index: number;
	repositoryName: string;
	source: "claude_code" | "codex" | undefined;
	placeholderOnly: boolean;
}) {
	const cellClassName = SESSION_OVERVIEW_CELL_CLASS_NAME;
	const model =
		source === "claude_code"
			? "claude"
			: source === "codex"
				? "gpt"
				: index % 2 === 0
					? "claude"
					: "gpt";
	const sourceLabel = placeholderOnly
		? ""
		: source === "claude_code"
			? "Claude"
			: source === "codex"
				? "Codex"
				: "";
	// Stable variation keeps the preview from reshuffling on connection updates.
	const variation = Math.imul(index + 1, 2654435761) >>> 0;
	const skills = Array.from(
		{ length: 1 + ((variation >>> 8) % 4) },
		(_, skillIndex) => ({
			id: `pending-skill-${variation}-${skillIndex}`,
			width:
				PENDING_SKILL_WIDTHS[
					(variation + skillIndex * 7) % PENDING_SKILL_WIDTHS.length
				],
		}),
	);
	const subagentCount = index % 4 === 1 ? 1 + ((variation >>> 6) % 4) : 0;
	const showErrors = (variation >>> 15) % 3 === 0;
	const apologyOverflowCount = (variation >>> 15) % 4;
	const [positiveCount = 0, negativeCount = 0] =
		PENDING_MEMBER_SIGNAL_COUNTS[index % PENDING_MEMBER_SIGNAL_COUNTS.length] ??
		[];
	return (
		<li
			aria-hidden="true"
			data-cli-preview-row
			data-cli-placeholder-only={placeholderOnly ? "" : undefined}
			data-session-disabled="true"
		>
			<div
				className={cn(
					SESSION_OVERVIEW_ROW_CLASS_NAME,
					SESSION_OVERVIEW_GRID_CLASS_NAME,
				)}
				data-dashboard-grid-row-scope="session"
			>
				<div className={cellClassName} data-session-overview-column="cost">
					<span
						className={cn(
							SESSION_OVERVIEW_METADATA_CLASS_NAME,
							"inline-flex items-center gap-1",
						)}
					>
						{placeholderOnly ? null : "$"}
						<span
							className={cn(
								"inline-block h-1.5 rounded-sm bg-black/8 dark:bg-white/10",
								index % 2 === 0 ? "w-4" : "w-5",
							)}
						/>
					</span>
				</div>
				<div
					className={cn(cellClassName, "gap-2 px-2")}
					data-session-overview-column="model"
				>
					<SessionModelMark
						avatarUrl={undefined}
						model={model}
						progress={{
							label: "API cost preview",
							maximumValue: 100,
							value:
								PENDING_COST_VALUES[index % PENDING_COST_VALUES.length] ?? 0,
						}}
						showMember={false}
						userLabel=""
					/>
					<div
						className="flex min-w-0 items-center gap-1.5"
						data-session-overview-model-repository
					>
						{sourceLabel ? (
							<p
								className="min-w-0 max-w-28 shrink-0 truncate text-base/5 font-[450] tracking-normal text-(--session-overview-text) sm:text-[0.8125rem]/5"
								data-session-overview-model-label
							>
								{sourceLabel}
							</p>
						) : (
							<span className="inline-block h-2 w-16 shrink-0 rounded-sm bg-black/8 dark:bg-white/10" />
						)}
						<p
							className="min-w-0 truncate text-left font-sans text-xs/4 font-normal tracking-normal text-[#0000009b] dark:text-[#ffffffaf]"
							data-session-overview-repository-label
						>
							{repositoryName}
						</p>
						<span className="inline-block h-1.5 w-12 shrink-0 rounded-sm bg-black/5 dark:bg-white/8" />
					</div>
					<SessionOverviewSubagentStack
						session={{
							subagent_count: subagentCount,
							subagent_types: [],
							native_subagents: Array.from(
								{ length: subagentCount },
								(_, agentIndex) => ({
									subagent_id: `pending-${index}-${agentIndex}`,
									model: model || null,
								}),
							),
						}}
					/>
					{/* Four of every eleven rows (about 36%) show an apology placeholder. */}
					{(index * 7 + 4) % 11 < 4 && (
						<SessionLanguageSignalTag
							category="apology"
							text={placeholderOnly ? <PendingSignalText /> : "Apology"}
							title="Model language signals will appear after upload"
							remainingCount={placeholderOnly ? 0 : apologyOverflowCount}
							remainingTitle="Additional model language signals will appear after upload"
						/>
					)}
					{showErrors && (
						<span
							className={cn(
								SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
								SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME,
								"shrink-0",
							)}
							data-session-overview-error-tag
							title="Error count will appear after upload"
						>
							<IconAlertCircle aria-hidden="true" className="size-3 shrink-0" />
							<span className="inline-block h-1.5 w-2 rounded-sm bg-current/20" />
						</span>
					)}
				</div>
				<div className={cellClassName} data-session-overview-column="skills">
					<div className="flex min-w-0 max-w-full items-center gap-1">
						{skills.map((skill) => (
							<ConversationTraceTag
								key={skill.id}
								className="min-w-0 max-w-full shrink"
								data-session-overview-skill-tag
								toolIcon="sparkle"
								value={skill.id}
							>
								<span
									className={cn(
										"my-1.5 inline-block h-1.5 max-w-full rounded-sm bg-black/8 dark:bg-white/10",
										skill.width,
									)}
								/>
							</ConversationTraceTag>
						))}
					</div>
				</div>
				<div
					className={cn(cellClassName, "justify-end gap-2")}
					data-session-overview-column="user"
				>
					<div
						className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden"
						data-language-signal-speaker="member"
					>
						{positiveCount > 0 && (
							<SessionLanguageSignalTag
								category="positive"
								text={placeholderOnly ? <PendingSignalText /> : "Positive"}
								title="Member language signals will appear after upload"
								remainingCount={placeholderOnly ? 0 : positiveCount - 1}
								remainingTitle="Additional positive language signals will appear after upload"
							/>
						)}
						{negativeCount > 0 && (
							<SessionLanguageSignalTag
								category="swear"
								text={placeholderOnly ? <PendingSignalText /> : "Negative"}
								title="Member language signals will appear after upload"
								remainingCount={placeholderOnly ? 0 : negativeCount - 1}
								remainingTitle="Additional negative language signals will appear after upload"
							/>
						)}
					</div>
					<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black/4 text-black/40 dark:bg-white/8 dark:text-white/40">
						<IconUser className="size-3.5" />
					</span>
				</div>
				<div
					className={cn(cellClassName, "justify-end px-2")}
					data-session-overview-column="time"
				>
					<span className="inline-block h-1.5 w-6 rounded-sm bg-black/8 dark:bg-white/10" />
				</div>
			</div>
		</li>
	);
}

function PendingSignalText() {
	return (
		<span className="my-1 inline-block h-1.5 w-9 rounded-sm bg-current/20" />
	);
}
