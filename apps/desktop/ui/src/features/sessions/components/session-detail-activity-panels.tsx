import { IconArrowLeft, IconChevronRight } from "@tabler/icons-react";
import { Button } from "@/app/ui/button";
import type {
	SessionDetailActivityGroup,
	SessionDetailActivityOccurrence,
} from "./session-detail-activity-groups";

export function SessionDetailActivityPanel({
	group,
	isLoading,
	onSelectOccurrence,
}: {
	group: SessionDetailActivityGroup;
	isLoading: boolean;
	onSelectOccurrence: (occurrence: SessionDetailActivityOccurrence) => void;
}) {
	return (
		<div className="min-h-0 overflow-hidden corner-s">
			{group.occurrences.length > 0 ? (
				<div className="max-h-72 overflow-y-auto">
					<ul
						aria-label={`${group.label} occurrences`}
						className="grid grid-cols-2 gap-xxs p-xs"
					>
						{group.occurrences.map((occurrence) => (
							<li key={occurrence.key}>
								<button
									className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-l corner-s px-xl py-l text-left hover:bg-black/3 dark:hover:bg-white/3"
									onClick={() => onSelectOccurrence(occurrence)}
									type="button"
								>
									<div className="min-w-0">
										<p className="whitespace-pre-wrap break-words text-[0.8125rem]/5 font-medium tracking-s text-ink-2 dark:text-ink-2">
											{occurrence.detail}
										</p>
										{occurrence.supportingDetail ? (
											<p className="mt-xxs text-[0.75rem]/4 tracking-s text-ink-3 tabular-nums dark:text-color-1-translucent">
												{occurrence.supportingDetail}
											</p>
										) : null}
									</div>
									<div className="flex min-w-0 items-center gap-s text-ink-3 dark:text-color-1-translucent">
										<p className="truncate text-[0.8125rem]/5 tracking-s tabular-nums">
											{occurrence.turnLabel}
											{occurrence.time ? ` · ${occurrence.time}` : ""}
										</p>
										<IconChevronRight
											aria-hidden="true"
											className="size-3.5 shrink-0"
										/>
									</div>
								</button>
							</li>
						))}
					</ul>
					{group.omittedCount > 0 ? (
						<p className="edge-t-m border-line px-xl py-m text-[0.75rem]/4 text-ink-3 tabular-nums dark:border-line dark:text-color-1-translucent">
							+{group.omittedCount.toLocaleString()} more not shown
						</p>
					) : null}
					{isLoading ? (
						<p className="edge-t-m border-line px-xl py-m text-[0.75rem]/4 text-ink-3 dark:border-line dark:text-color-1-translucent">
							Loading more signal occurrences…
						</p>
					) : null}
				</div>
			) : isLoading ? (
				<p className="px-xl py-l text-body-xxl text-ink-3 sm:text-[0.8125rem]/5 dark:text-color-1-translucent">
					Loading signal occurrences…
				</p>
			) : (
				<p className="px-xl py-l text-body-xxl text-ink-3 sm:text-[0.8125rem]/5 dark:text-color-1-translucent">
					{group.emptyLabel}
				</p>
			)}
		</div>
	);
}

export function SessionDetailActivityOccurrencePanel({
	group,
	onBack,
	onClose,
	onJump,
	occurrence,
}: {
	group: SessionDetailActivityGroup;
	onBack: () => void;
	onClose: () => void;
	onJump: (target: { eventId: string | undefined; turnIndex: number }) => void;
	occurrence: SessionDetailActivityOccurrence;
}) {
	return (
		<div className="min-h-0 overflow-hidden corner-s">
			<div className="flex h-9 items-center edge-b-m border-line px-xs dark:border-line">
				<button
					aria-label={`Back to ${group.label}`}
					className="flex size-7 shrink-0 items-center justify-center corner-s text-ink-2 outline-none hover:bg-black/4 dark:text-ink-2 dark:hover:bg-white/6"
					onClick={onBack}
					type="button"
				>
					<IconArrowLeft aria-hidden="true" className="size-3.5" />
				</button>
				<p className="min-w-0 flex-1 truncate px-xs text-[0.8125rem]/5 font-medium">
					{group.label}
				</p>
			</div>
			<div className="p-xl">
				<p className="whitespace-pre-wrap break-words text-[0.8125rem]/5 font-medium tracking-s text-ink-2 dark:text-ink-2">
					{occurrence.detail}
				</p>
				{occurrence.supportingDetail ? (
					<p className="mt-xs text-[0.75rem]/4 tracking-s text-ink-3 tabular-nums dark:text-color-1-translucent">
						{occurrence.supportingDetail}
					</p>
				) : null}
				<p className="mt-m text-[0.75rem]/4 tracking-s text-ink-3 tabular-nums dark:text-color-1-translucent">
					{occurrence.turnLabel}
					{occurrence.time ? ` · ${occurrence.time}` : ""}
				</p>
				<Button
					className="mt-l"
					onClick={() => {
						onJump({
							eventId: occurrence.eventId,
							turnIndex: occurrence.turnIndex,
						});
						window.setTimeout(onClose, 0);
					}}
					size="xs"
					type="button"
				>
					View in transcript
				</Button>
			</div>
		</div>
	);
}
