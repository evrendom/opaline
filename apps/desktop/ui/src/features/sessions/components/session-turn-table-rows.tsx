import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { Pressable } from "@/app/ui/pressable";
import type { SessionCompaction } from "./session-compactions";
import type { SessionTurnEpisode } from "./session-turn-episodes";

export function SessionTurnCompactionRow({
	compaction,
}: {
	compaction: SessionCompaction;
}) {
	return (
		<tr
			className="flex h-7 min-w-full items-center edge-y-m border-warning-line bg-warning-tint px-l text-body-m font-medium text-warning"
			title={new Date(compaction.timestamp).toLocaleString()}
		>
			<td>Compaction</td>
		</tr>
	);
}

export function SessionTurnEpisodeRow({
	collapsed,
	episode,
	onToggle,
}: {
	collapsed: boolean;
	episode: SessionTurnEpisode;
	onToggle: (() => void) | undefined;
}) {
	return (
		<tr className="min-w-full edge-b-m border-line bg-inset">
			<td>
				<Pressable
					type="button"
					aria-expanded={!collapsed}
					className="flex min-h-9 w-full items-center gap-m px-l text-left text-body-m font-medium text-ink"
					onClick={onToggle}
				>
					{collapsed ? (
						<IconChevronRight
							aria-hidden="true"
							className="size-3.5 shrink-0"
						/>
					) : (
						<IconChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
					)}
					<span className="min-w-0 flex-1 truncate">{episode.label}</span>
					<span className="shrink-0 font-regular text-ink-3 tabular-nums">
						{episode.indices.length} turns · {episode.stats.tools} tools
					</span>
				</Pressable>
			</td>
		</tr>
	);
}
