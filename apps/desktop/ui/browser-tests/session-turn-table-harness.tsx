import { createRoot } from "react-dom/client";
import {
	SessionTurnTable,
	type SessionTurnTableOption,
	type SessionTurnTableRow,
	type SessionTurnTableSpeaker,
} from "../src/features/sessions/components/session-turn-table";
import {
	DEFAULT_SESSION_TURN_TABLE_COLUMNS,
	type SessionTurnTableColumnKey,
} from "../src/features/sessions/components/session-turn-table-column-options";
import "../src/index.css";

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario");
const options: SessionTurnTableOption[] = Array.from(
	{ length: 30 },
	(_, index) => ({
		compactionsBefore: [],
		key: `turn-${index}`,
		metrics: {
			editedFiles: [],
			errorCount: 0,
			errorEvents: [],
			estimatedCost: 0.04,
			inputTokens: 1_200 + index,
			outputTokens: 480,
			skills: [],
			skillEvents: [],
			usageEvents: [],
		},
		slashCommands: scenario === "extra" ? ["/review", "/plan"] : [],
		timing: {
			durationLabel: "2 min",
			durationSeconds: 120,
			endTime: "10:02",
			startTime: "10:00",
		},
		toolCallCount: 3,
		turnNumber: index + 1,
	}),
);
const speakers: readonly SessionTurnTableSpeaker[] = ["member", "model"];
const rows: SessionTurnTableRow[] = options.flatMap((option, index) =>
	speakers.map((speaker) => ({
		key: `${option.key}:${speaker}`,
		match: { index, option },
		memberText:
			speaker === "member"
				? "Review the session and check the upload progress."
				: undefined,
		signalCount: 0,
		speaker,
		subagentCount: 0,
		toolCallGroups: [],
	})),
);
const visibleColumnKeys = new Set<SessionTurnTableColumnKey>(
	scenario === "member"
		? ["time"]
		: scenario === "extra"
			? [
					...DEFAULT_SESSION_TURN_TABLE_COLUMNS,
					"errors",
					"files",
					"skills",
					"signals",
				]
			: DEFAULT_SESSION_TURN_TABLE_COLUMNS,
);
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");

createRoot(root).render(
	<main
		data-ledger-pane
		className="m-8 flex h-110 flex-col [--session-turn-table-surface:white]"
		style={{ width: Number(params.get("width") ?? 320) }}
	>
		<SessionTurnTable
			model="claude-sonnet-4"
			onSelect={() => undefined}
			onSort={() => undefined}
			options={options}
			rows={rows}
			selection={{ index: 0, speaker: "model" }}
			sessionDurationLabel="1h"
			showSpeakerColumn={scenario !== "no-speaker"}
			speakerVisibilityControls={null}
			sort={{ key: "time", direction: "asc" }}
			visibleColumnKeys={visibleColumnKeys}
			visibleOptions={options.map((option, index) => ({ index, option }))}
		/>
	</main>,
);
