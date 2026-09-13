import demoData from "../data/demo-sessions.json";
import "./DemoSessionsBoard.css";

interface DemoSession {
	id: string;
	source: "codex" | "claude";
	developer: string;
	date: string;
	repository: string;
	model: string;
	interactions: number;
	durationMin: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	estimatedCost: number;
	successScore: number;
	errorCount: number;
	hasCommit: boolean;
}

interface DemoData {
	org: { name: string; slug: string };
	members: { name: string; role: string }[];
	sessions: DemoSession[];
}

const data = demoData as DemoData;

const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

function money(value: number): string {
	if (value >= 100) return `$${Math.round(value).toLocaleString("en-US")}`;
	return `$${value.toFixed(2)}`;
}

function shortDate(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initial(name: string): string {
	return name.slice(0, 1).toUpperCase();
}

const MODEL_TONE: Record<string, string> = {
	"Fable 5": "warm",
	"GPT-5.6": "cool",
};

function rangeLabel(sessions: DemoSession[]): string {
	if (sessions.length === 0) return "";
	const dates = sessions.map((s) => new Date(s.date).getTime());
	const min = new Date(Math.min(...dates));
	const max = new Date(Math.max(...dates));
	const fmt = (d: Date) =>
		d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	return `${fmt(min)} – ${fmt(max)}, ${max.getFullYear()}`;
}

export function DemoSessionsBoard() {
	const { org, members, sessions } = data;
	const ordered = [...sessions].sort(
		(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
	);

	return (
		<section className="demo-board" aria-label={`${org.name} sessions`}>
			<div className="demo-board-chrome">
				<div className="demo-board-title">
					<span className="demo-board-org-mark">{initial(org.name)}</span>
					<span className="demo-board-org-name">{org.name}</span>
					<span className="demo-board-crumb">Sessions</span>
				</div>
				<div className="demo-board-members">
					{members.map((m) => (
						<span
							key={m.name}
							className="demo-board-avatar"
							title={`${m.name} · ${m.role}`}
							data-name={m.name}
						>
							{initial(m.name)}
						</span>
					))}
				</div>
			</div>

			<div className="demo-board-toolbar">
				<span className="demo-board-chip demo-board-chip-strong">
					{rangeLabel(sessions)}
				</span>
				<span className="demo-board-chip">Sorted by Time</span>
				<span className="demo-board-chip">Filter</span>
				<span className="demo-board-count">{sessions.length} sessions</span>
			</div>

			<div className="demo-board-scroll">
				<table className="demo-board-table">
					<thead>
						<tr>
							<th className="demo-col-when">When</th>
							<th className="demo-col-dev">Developer</th>
							<th className="demo-col-repo">Repository</th>
							<th className="demo-col-model">Model</th>
							<th className="demo-col-num">Input</th>
							<th className="demo-col-num">Output</th>
							<th className="demo-col-num">API cost</th>
							<th className="demo-col-num">Errors</th>
						</tr>
					</thead>
					<tbody>
						{ordered.map((s) => (
							<tr key={s.id}>
								<td className="demo-col-when">{shortDate(s.date)}</td>
								<td className="demo-col-dev">
									<span
										className="demo-board-avatar demo-board-avatar-sm"
										data-name={s.developer}
									>
										{initial(s.developer)}
									</span>
									{s.developer}
								</td>
								<td className="demo-col-repo">
									<span className="demo-board-repo">{s.repository}</span>
								</td>
								<td className="demo-col-model">
									<span
										className="demo-board-model"
										data-tone={MODEL_TONE[s.model] ?? "cool"}
									>
										{s.model}
									</span>
								</td>
								<td className="demo-col-num">
									{compact.format(s.inputTokens)}
								</td>
								<td className="demo-col-num">
									{compact.format(s.outputTokens)}
								</td>
								<td className="demo-col-num demo-col-cost">
									{money(s.estimatedCost)}
								</td>
								<td className="demo-col-num">
									<span
										className="demo-board-errors"
										data-zero={s.errorCount === 0 ? "true" : undefined}
									>
										{s.errorCount}
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
