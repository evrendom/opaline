import { IconArrowUpRight } from "@tabler/icons-react";
import { useContext } from "react";
import { Link } from "react-router-dom";
import { ConversationSkillTurnContext } from "@/components/conversation/conversation-skill-link";
import { mcpTool } from "../../model/session-reader-mcp-tool";
import type { SessionReaderStep } from "../../model/session-reader-run-steps";
import { LANE_LOOK } from "../../model/session-reader-step-lanes";
import { useSessionFileOf, useSessionPlaces } from "../../session-places";
import { useSubagentTintOf } from "../../subagents/session-reader-subagent-tints";

type Place = { href: string; label: string; tint: string };

function pullRequestNumber(step: SessionReaderStep): number | null {
	const text = `${step.command?.chain ?? ""} ${step.detail ?? ""}`;
	const match =
		/\bgh\s+pr\s+[a-z-]+\s+#?(\d+)\b/u.exec(text) ??
		/\/pull\/(\d+)\b/u.exec(text);
	return match ? Number(match[1]) : null;
}

export function StepPlaces({
	agentId,
	step,
}: {
	agentId: string | null;
	step: SessionReaderStep;
}) {
	const places = useSessionPlaces();
	const fileOf = useSessionFileOf();
	const turnId = useContext(ConversationSkillTurnContext);
	const tintOf = useSubagentTintOf();
	if (!places) return null;
	const found: Place[] = [];

	const files = [
		...new Set(
			(step.files ?? [])
				.map((op) => fileOf(op.path))
				.filter((file): file is string => file !== null),
		),
	];
	const first = files[0];
	if (first)
		found.push({
			href: places.hrefs.file({ file: first, run: turnId }),
			label:
				files.length > 1 ? `Open in Files (${files.length})` : "Open in Files",
			tint: LANE_LOOK.edit.tint,
		});

	const mcp = step.toolEvent ? mcpTool(step.toolEvent.toolName) : null;
	const server = mcp ? places.mcpSetupFile(mcp.server) : null;
	if (server)
		found.push({
			href: places.hrefs.setup(server),
			label: "Open MCP server",
			tint: LANE_LOOK.tools.tint,
		});

	const ci = step.ci && step.ci.kind !== "group" ? step.ci.run : null;
	if (ci)
		found.push({
			href: places.hrefs.ci({ ci: ci.ciRunId }),
			label: "Open in CI & PRs",
			tint: LANE_LOOK.ci.tint,
		});

	const number =
		step.command?.kind === "github" || step.detail?.includes("/pull/")
			? pullRequestNumber(step)
			: null;
	const pr = number !== null ? places.pullRequestOf(number) : null;
	if (pr && !ci)
		found.push({
			href: places.hrefs.ci({ pr }),
			label: `Open PR #${number}`,
			tint: LANE_LOOK.ci.tint,
		});

	if (agentId)
		found.push({
			href: places.hrefs.subagent(agentId),
			label: "Open its thread",
			tint: tintOf(step) ?? LANE_LOOK.agent.tint,
		});

	if (found.length === 0) return null;
	return (
		<div className="flex shrink-0 flex-wrap gap-s px-xxl pt-l pb-m">
			{found.map((place) => (
				<Link
					key={place.href}
					to={place.href}
					aria-label={place.label}
					title={place.label}
					className="inline-flex items-center gap-xs corner-full bg-card py-xs pr-m pl-l text-body-m font-medium shadow-card transition-colors hover:bg-hover dark:bg-ink-3/10"
				>
					Open details
					<IconArrowUpRight
						aria-hidden="true"
						className="size-3.5"
						style={{ color: place.tint }}
					/>
				</Link>
			))}
		</div>
	);
}
