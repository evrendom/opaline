import { IconCircleXFilled } from "@tabler/icons-react";
import { MOMENT_KINDS_APPEARANCE } from "@/features/compass/moment-labels";
import { FlagChip } from "@/features/compass/session-flags";
import { OpalChip } from "../detail/waterfall/session-reader-waterfall-chips";
import {
	type BoxProblems,
	type Tone,
	TYPES,
	toneOf,
} from "./session-reader-context-problems";

const TONE_TINT: Record<Tone, string> = {
	later: "var(--color-opal-4)",
	minor: "var(--color-opal-3)",
	never: "var(--color-rose-500)",
};

export function RunLegend({
	problems,
	turnId,
}: {
	problems: BoxProblems | undefined;
	turnId: string;
}) {
	const run = problems?.runs.get(turnId);
	if (!run) return null;
	const calls = TYPES.flatMap((type) => {
		const found = run.calls.get(type.key) ?? [];
		return found.length > 0 ? [{ count: found.length, type }] : [];
	});
	if (run.flags.length === 0 && calls.length === 0) return null;
	return (
		<ul className="pointer-events-auto absolute bottom-2 left-2 z-30 flex max-w-[60%] flex-col gap-xs corner-m bg-surface px-l py-m text-body-m shadow-card backdrop-blur-sm corner-squircle squircle:corner-xl">
			{run.flags.map((kind) => (
				<li key={kind} className="flex min-w-0 items-center gap-m">
					<FlagChip kind={kind} />
					<span className="truncate">
						{MOMENT_KINDS_APPEARANCE[kind].label}
					</span>
				</li>
			))}
			{calls.map(({ count, type }) => (
				<li key={type.key} className="flex min-w-0 items-center gap-m">
					<OpalChip solid tint={TONE_TINT[toneOf(type.key)]} className="size-4">
						<IconCircleXFilled
							aria-hidden="true"
							className="size-2.5"
							style={{ color: TONE_TINT[toneOf(type.key)] }}
						/>
					</OpalChip>
					<span className="truncate">
						{type.label}
						<span className="text-ink-3 tabular-nums">
							{" "}
							· {count} {count === 1 ? "call" : "calls"}
						</span>
					</span>
				</li>
			))}
		</ul>
	);
}
