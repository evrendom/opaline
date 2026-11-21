import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/app/ui/dropdown-menu";
import { TouchTarget } from "@/app/ui/touch-target";
import {
	ModelTraceIcon,
	UserTraceAvatar,
} from "@/components/conversation/conversation-trace-icons";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { cn } from "@/lib/utils";
import type { SessionTurnTableSpeaker } from "./session-turn-table";
import {
	type SessionTurnTableSpeakerSelection,
	toggleSessionTurnTableSpeakerVisibility,
} from "./session-turn-table-speaker-visibility";

const SESSION_TURN_TABLE_SPEAKERS: readonly SessionTurnTableSpeaker[] = [
	"member",
	"model",
];

function SessionTurnTableSpeakerIcon({
	model,
	speaker,
	userImageUrl,
}: {
	model: string | undefined;
	speaker: SessionTurnTableSpeaker;
	userImageUrl: string | undefined;
}) {
	return speaker === "model" ? (
		<span className="session-turn-table-model-icon-shell relative flex size-5 shrink-0">
			<ModelTraceIcon
				className="session-turn-table-model-icon size-5"
				expandable={false}
				expanded={false}
				model={model}
			/>
		</span>
	) : (
		<UserTraceAvatar
			className="size-5"
			expandable={false}
			expanded={false}
			imageUrl={userImageUrl}
		/>
	);
}

export function SessionTurnTableSpeakerVisibilityControls({
	className,
	model,
	onPrimarySpeakerChange,
	onVisibleSpeakersChange,
	primarySpeaker,
	userImageUrl,
	userLabel,
	visibleSpeakers,
}: {
	className: string | undefined;
	model: string | undefined;
	onPrimarySpeakerChange: (speaker: SessionTurnTableSpeaker) => void;
	onVisibleSpeakersChange: (
		speakers: ReadonlySet<SessionTurnTableSpeaker>,
	) => void;
	primarySpeaker: SessionTurnTableSpeaker;
	userImageUrl: string | undefined;
	userLabel: string;
	visibleSpeakers: ReadonlySet<SessionTurnTableSpeaker>;
}) {
	const modelLabel = model ? formatModelDisplayLabel(model) : "Model";
	const speakerLabels: Readonly<Record<SessionTurnTableSpeaker, string>> = {
		member: userLabel,
		model: modelLabel,
	};
	function applySelection(selection: SessionTurnTableSpeakerSelection) {
		onVisibleSpeakersChange(selection.visibleSpeakers);
		onPrimarySpeakerChange(selection.primarySpeaker);
	}

	function handleVisibilityToggle(speaker: SessionTurnTableSpeaker) {
		applySelection(
			toggleSessionTurnTableSpeakerVisibility({
				primarySpeaker,
				speaker,
				visibleSpeakers,
			}),
		);
	}
	const visibleSpeakerLabel = SESSION_TURN_TABLE_SPEAKERS.filter((speaker) =>
		visibleSpeakers.has(speaker),
	)
		.map((speaker) => speakerLabels[speaker])
		.join(" and ");

	return (
		<fieldset
			className={cn(
				"session-constellation-tree m-zero flex h-full w-full min-w-0 shrink-0 items-center edge-none p-zero pl-xs",
				className,
			)}
		>
			<legend className="sr-only">Visible turn table rows</legend>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<button
							type="button"
							aria-label={`Choose visible rows: ${visibleSpeakerLabel}`}
							className={cn(
								"relative flex h-8 w-9 shrink-0 items-center justify-start",
								"corner-xs",
								"focus-outline",
								"focus-visible:z-10",
							)}
						/>
					}
				>
					<span
						aria-hidden="true"
						className="pointer-events-none flex items-center"
						data-trace-tree-row-content
					>
						{SESSION_TURN_TABLE_SPEAKERS.map((speaker, optionIndex) => {
							const selected = visibleSpeakers.has(speaker);
							return (
								<span
									key={speaker}
									className={cn(
										"relative flex size-5 shrink-0 items-center justify-center",
										optionIndex === 0 ? "z-0" : "z-10 -ml-l",
										!selected && "saturate-0 opacity-35",
									)}
									data-selected={selected}
									data-speaker-icon
									data-turn-table-speaker-trigger-icon={speaker}
								>
									<SessionTurnTableSpeakerIcon
										model={model}
										speaker={speaker}
										userImageUrl={userImageUrl}
									/>
								</span>
							);
						})}
					</span>
					<TouchTarget className="pointer-events-none" />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					// design-escape-ok(opacity): no role renders this; ring-ink/10
					className="w-auto min-w-40 corner-m bg-canvas p-xs text-ink shadow-float ring-1 ring-ink/10 dark:bg-surface dark:text-ink"
					sideOffset={4}
				>
					{SESSION_TURN_TABLE_SPEAKERS.map((speaker) => {
						const selected = visibleSpeakers.has(speaker);
						const isOnlyVisible = selected && visibleSpeakers.size === 1;
						return (
							<DropdownMenuCheckboxItem
								key={speaker}
								checked={selected}
								className={cn(
									"corner-s py-s pr-[calc(var(--space-xxl)*1.25)] pl-m text-body-m font-medium",
									!selected && "opacity-40",
								)}
								closeOnClick={false}
								data-turn-table-speaker={speaker}
								onCheckedChange={() => handleVisibilityToggle(speaker)}
								title={
									isOnlyVisible
										? "At least one row type must remain visible"
										: undefined
								}
							>
								<span
									className={cn("flex shrink-0", !selected && "saturate-0")}
								>
									<SessionTurnTableSpeakerIcon
										model={model}
										speaker={speaker}
										userImageUrl={userImageUrl}
									/>
								</span>
								{speakerLabels[speaker]}
							</DropdownMenuCheckboxItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		</fieldset>
	);
}
