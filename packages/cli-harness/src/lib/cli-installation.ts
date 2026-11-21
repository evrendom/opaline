import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const INSTALLATION_STATE_FILE = "product-analytics.json";

type InstallationState = {
	cli_installation_id?: string;
};

function getConfigDir() {
	return process.env.RUDEL_CONFIG_DIR ?? join(homedir(), ".rudel");
}

function readInstallationState(): InstallationState {
	const statePath = join(getConfigDir(), INSTALLATION_STATE_FILE);
	if (!existsSync(statePath)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(statePath, "utf8")) as InstallationState;
	} catch {
		return {};
	}
}

export function getOrCreateCliInstallationId() {
	const state = readInstallationState();
	if (typeof state.cli_installation_id === "string") {
		return state.cli_installation_id;
	}
	const cliInstallationId = randomUUID();
	mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
	writeFileSync(
		join(getConfigDir(), INSTALLATION_STATE_FILE),
		JSON.stringify(
			{ ...state, cli_installation_id: cliInstallationId },
			null,
			2,
		),
		{ mode: 0o600 },
	);
	return cliInstallationId;
}
