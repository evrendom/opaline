import { MOMENT_KINDS_APPEARANCE } from "@/features/compass/moment-labels";
import { ViewToggle } from "../files/session-reader-files-parts";

export * from "@rudel/api-routes/session-context/session-reader-context-compaction";

const COMPACTION = MOMENT_KINDS_APPEARANCE.compaction;

const COMPACTION_VIEWS = [
	{ id: "without", label: "Without compaction" },
	{ icon: COMPACTION.icon, id: "with", label: "With compaction" },
] as const;

export const compactionWords = COMPACTION.label.toLowerCase();

export function CompactionMark() {
	return <COMPACTION.icon aria-hidden="true" className="size-3.5 shrink-0" />;
}

export function CompactionToggle({
	onChange,
	value,
}: {
	onChange: (withCompaction: boolean) => void;
	value: boolean;
}) {
	return (
		<span className="inline-flex shrink-0 self-start corner-m bg-wash p-xxs corner-squircle squircle:corner-l dark:bg-wash">
			<ViewToggle
				label="Context"
				onPick={(view) => onChange(view === "with")}
				options={COMPACTION_VIEWS}
				value={value ? "with" : "without"}
			/>
		</span>
	);
}
