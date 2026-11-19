// Email lab: the usage digest emails rendered from fixtures, with a client
// simulator and Agentation.
//
//   bun run --cwd app/ui dev:email-lab   → http://localhost:4011/email-lab.html
//
// The simulator reads caniemail.com's support data (MIT). This server
// downloads it once and serves it from a cache outside the repository,
// refreshed weekly; a failed refresh keeps serving the cached copy.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ConfigEnv, Plugin, UserConfig } from "vite";
import baseConfig from "./vite.config";

const DATA_URL = "https://www.caniemail.com/api/data.json";
const DATA_PATH = "/__email-lab/caniemail.json";
const CACHE = path.join(tmpdir(), "opaline-email-lab", "caniemail.json");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function caniemailData(): Promise<string> {
	const cached = await stat(CACHE).catch(() => null);
	if (cached && Date.now() - cached.mtimeMs < MAX_AGE_MS)
		return readFile(CACHE, "utf8");
	try {
		const response = await fetch(DATA_URL);
		if (!response.ok) throw new Error(`caniemail answered ${response.status}`);
		const body = await response.text();
		JSON.parse(body);
		await mkdir(path.dirname(CACHE), { recursive: true });
		await writeFile(CACHE, body);
		return body;
	} catch (error) {
		if (cached) return readFile(CACHE, "utf8");
		throw error;
	}
}

const emailLab: Plugin = {
	name: "email-lab",
	configureServer(server) {
		server.middlewares.use(DATA_PATH, (_request, response) => {
			caniemailData().then(
				(body) => {
					response.setHeader("Content-Type", "application/json");
					response.end(body);
				},
				(error: unknown) => {
					response.statusCode = 502;
					response.end(String(error));
				},
			);
		});
	},
};

export default async (env: ConfigEnv): Promise<UserConfig> => {
	const config =
		typeof baseConfig === "function" ? await baseConfig(env) : await baseConfig;
	return {
		...config,
		plugins: [...(config.plugins ?? []), emailLab],
	};
};
