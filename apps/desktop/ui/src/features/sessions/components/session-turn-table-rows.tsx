import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { SessionCompaction } from "./session-compactions";
import type { SessionTurnEpisode } from "./session-turn-episodes";

export function SessionTurnCompactionRow({
	compaction,
}: {
	compaction: SessionCompaction;
}) {
	return (
		<tr
			// design-escape-ok: dark lifts the compaction row's warning text to amber-300; no role holds it (listed)
			className="flex h-7 min-w-full items-center edge-y-m border-warning-line/70 bg-inset px-l text-body-m font-medium text-warning dark:border-warning/15 dark:bg-warning/10 dark:text-amber-300"
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
		<tr className="min-w-full edge-b-m border-line-strong bg-[color-mix(in_srgb,var(--hover)_72%,var(--canvas))]">
			<td>
				<button
					type="button"
					aria-expanded={!collapsed}
					className="flex min-h-9 w-full items-center gap-m px-l text-left text-body-m font-medium text-ink outline-none"
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
				</button>
			</td>
		</tr>
	);
}
