import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexSessionMeta } from "./index.js";

test("reads current Codex commit_hash metadata", async () => {
	const directory = await mkdtemp(join(tmpdir(), "opaline-codex-meta-"));
	const transcriptPath = join(directory, "session.jsonl");
	await writeFile(
		transcriptPath,
		`${JSON.stringify({
			payload: {
				cwd: "/repo",
				git: {
					branch: "main",
					commit_hash: "0123456789abcdef",
					repository_url: "git@github.com:opaline/repo.git",
				},
				id: "session-current",
			},
			type: "session_meta",
		})}\n`,
		"utf8",
	);

	const meta = await readCodexSessionMeta(transcriptPath);

	expect(meta).toEqual({
		cwd: "/repo",
		gitBranch: "main",
		gitSha: "0123456789abcdef",
		id: "session-current",
	});
	await rm(directory, { recursive: true });
});
