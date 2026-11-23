import { IconArrowLeft, IconChevronRight } from "@tabler/icons-react";
import { Button } from "@/app/ui/button";
import { Pressable } from "@/app/ui/pressable";
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
								<Pressable
									className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-l corner-s px-xl py-l hover:bg-hover"
									onClick={() => onSelectOccurrence(occurrence)}
									type="button"
								>
									<div className="min-w-0">
										<p className="whitespace-pre-wrap break-words text-body-l font-medium tracking-s text-ink-2">
											{occurrence.detail}
										</p>
										{occurrence.supportingDetail ? (
											<p className="mt-xxs text-body-m tracking-s text-ink-3 tabular-nums">
												{occurrence.supportingDetail}
											</p>
										) : null}
									</div>
									<div className="flex min-w-0 items-center gap-s text-ink-3">
										<p className="truncate text-body-l tracking-s tabular-nums">
											{occurrence.turnLabel}
											{occurrence.time ? ` · ${occurrence.time}` : ""}
										</p>
										<IconChevronRight
											aria-hidden="true"
											className="size-3.5 shrink-0"
										/>
									</div>
								</Pressable>
							</li>
						))}
					</ul>
					{group.omittedCount > 0 ? (
						<p className="edge-t-m border-line px-xl py-m text-body-m text-ink-3 tabular-nums">
							+{group.omittedCount.toLocaleString()} more not shown
						</p>
					) : null}
					{isLoading ? (
						<p className="edge-t-m border-line px-xl py-m text-body-m text-ink-3">
							Loading more signal occurrences…
						</p>
					) : null}
				</div>
			) : isLoading ? (
				<p className="px-xl py-l text-body-xxl text-ink-3 sm:text-body-l">
					Loading signal occurrences…
				</p>
			) : (
				<p className="px-xl py-l text-body-xxl text-ink-3 sm:text-body-l">
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
			<div className="flex h-9 items-center edge-b-m border-line px-xs">
				<Button
					aria-label={`Back to ${group.label}`}
					onClick={onBack}
					size="icon-sm"
					type="button"
					variant="secondary"
				>
					<IconArrowLeft aria-hidden="true" className="size-3.5 text-current" />
				</Button>
				<p className="min-w-0 flex-1 truncate px-xs text-body-l font-medium">
					{group.label}
				</p>
			</div>
			<div className="p-xl">
				<p className="whitespace-pre-wrap break-words text-body-l font-medium tracking-s text-ink-2">
					{occurrence.detail}
				</p>
				{occurrence.supportingDetail ? (
					<p className="mt-xs text-body-m tracking-s text-ink-3 tabular-nums">
						{occurrence.supportingDetail}
					</p>
				) : null}
				<p className="mt-m text-body-m tracking-s text-ink-3 tabular-nums">
					{occurrence.turnLabel}
					{occurrence.time ? ` · ${occurrence.time}` : ""}
				</p>
				<Button
					variant="primary"
					className="mt-l"
					onClick={() => {
						onJump({
							eventId: occurrence.eventId,
							turnIndex: occurrence.turnIndex,
						});
						window.setTimeout(onClose, 0);
					}}
					size="sm"
					type="button"
				>
					View in transcript
				</Button>
			</div>
		</div>
	);
}
