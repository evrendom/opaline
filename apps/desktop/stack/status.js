const IDLE_POLL_MS = 60_000;
const BUSY_POLL_MS = 5_000;
const HIDDEN_POLL_MS = 300_000;

function formatEta(seconds) {
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
		return "";
	if (seconds < 60) return "less than a minute left";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `about ${minutes} min left`;
	const hours = Math.floor(minutes / 60);
	return `about ${hours} h ${minutes % 60} min left`;
}

function parseIngestStatus(status, body) {
	if (status === 404) return { available: false };
	if (status < 200 || status >= 300 || !body || typeof body !== "object")
		return { available: false, error: true };
	const number = (value) =>
		typeof value === "number" && Number.isFinite(value) ? value : 0;
	const state = ["idle", "importing", "paused"].includes(body.state)
		? body.state
		: "idle";
	return {
		available: true,
		state,
		sessionsSeen: number(body.sessionsSeen),
		sessionsIngested: number(body.sessionsIngested),
		sessionsQueued: number(body.sessionsQueued),
		bytesQueued: number(body.bytesQueued),
		lastIngestAt:
			typeof body.lastIngestAt === "string" ? body.lastIngestAt : null,
		etaSeconds: typeof body.etaSeconds === "number" ? body.etaSeconds : null,
		backgroundPriority: body.backgroundPriority === true,
	};
}

function describeImport(ingest, cliImport) {
	if (ingest?.available && ingest.state === "importing") {
		const total = Math.max(
			ingest.sessionsSeen,
			ingest.sessionsIngested + ingest.sessionsQueued,
		);
		const eta = formatEta(ingest.etaSeconds);
		return `Importing history: ${ingest.sessionsIngested} of ${total} sessions${eta ? `, ${eta}` : ""}`;
	}
	if (ingest?.available && ingest.state === "paused")
		return "History import paused";
	if (cliImport?.running) {
		if (cliImport.total > 0)
			return `Importing history: ${cliImport.completed} of ${cliImport.total} sessions`;
		return "Importing history…";
	}
	return undefined;
}

function isBusy(ingest, cliImport) {
	return Boolean(
		(ingest?.available && ingest.state === "importing") || cliImport?.running,
	);
}

function nextPollDelay({ ingest, cliImport, windowVisible }) {
	if (isBusy(ingest, cliImport)) return BUSY_POLL_MS;
	return windowVisible ? IDLE_POLL_MS : HIDDEN_POLL_MS;
}

function statusSummary({
	environment,
	running,
	sessionsToday,
	paused,
	ingest,
	cliImport,
}) {
	const lines = [];
	if (environment === "This Mac")
		lines.push(
			running === undefined
				? "Checking Opaline…"
				: running
					? "Opaline is running on this Mac"
					: "Opaline is stopped",
		);
	else
		lines.push(
			running === false
				? `${environment} is not reachable`
				: `Connected to ${environment}`,
		);
	if (typeof sessionsToday === "number")
		lines.push(
			`${sessionsToday} ${sessionsToday === 1 ? "session" : "sessions"} today`,
		);
	const importing = describeImport(ingest, cliImport);
	if (importing) lines.push(importing);
	if (paused) lines.push("Uploads are paused");
	return lines;
}

module.exports = {
	BUSY_POLL_MS,
	HIDDEN_POLL_MS,
	IDLE_POLL_MS,
	describeImport,
	formatEta,
	isBusy,
	nextPollDelay,
	parseIngestStatus,
	statusSummary,
};
