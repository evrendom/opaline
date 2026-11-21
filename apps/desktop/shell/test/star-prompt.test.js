const { describe, expect, test } = require("bun:test");
const { createStarPrompt } = require("../star-prompt");

const HOUR = 60 * 60 * 1000;

function memoryFs() {
	const files = new Map();
	return {
		files,
		readFileSync: (file) => {
			if (!files.has(file)) throw new Error("missing");
			return files.get(file);
		},
		writeFileSync: (file, data) => files.set(file, data),
	};
}

function setup({ gh = {}, idle = 0, usedMs = 0 } = {}) {
	const fsImpl = memoryFs();
	if (usedMs) fsImpl.files.set("star.json", JSON.stringify({ usedMs }));
	let clock = 0;
	const calls = { gh: [], opened: [] };
	const prompt = createStarPrompt({
		file: "star.json",
		fsImpl,
		now: () => clock,
		idleSeconds: () => idle,
		gh: async (args) => {
			calls.gh.push(args.join(" "));
			const key = args.includes("PUT")
				? "put"
				: args[1].startsWith("user/starred")
					? "check"
					: "count";
			return gh[key] ?? { ok: false, stdout: "" };
		},
		openInBackground: async (url) => calls.opened.push(url),
	});
	const advance = (ms, focused = true) => {
		clock += ms;
		prompt.tick(focused);
	};
	return { prompt, advance, calls, fsImpl };
}

describe("star prompt", () => {
	test("counts only focused, non-idle time, and asks after an hour", async () => {
		const { prompt, advance } = setup({
			gh: { count: { ok: true, stdout: "311\n" } },
		});
		advance(0);
		for (let i = 0; i < 100; i++) advance(30_000);
		advance(60 * 60_000, false); // an unfocused stretch never counts
		expect(prompt.state().usedMs).toBe(50 * 60_000);
		expect((await prompt.status()).show).toBe(false);
		advance(0); // the first focused tick after a break only restarts the stopwatch
		for (let i = 0; i < 20; i++) advance(30_000);
		expect(await prompt.status()).toEqual({ show: true, count: 311 });
	});

	test("idle time does not count", () => {
		const { prompt, advance } = setup({ idle: 10 * 60 });
		advance(0);
		advance(30_000);
		expect(prompt.state().usedMs).toBe(0);
	});

	test("stays quiet for someone who already starred the repository", async () => {
		const { prompt } = setup({
			usedMs: HOUR,
			gh: {
				check: { ok: true, stdout: "" },
				count: { ok: true, stdout: "311" },
			},
		});
		expect((await prompt.status()).show).toBe(false);
		expect(prompt.state().starredAt).not.toBeNull();
	});

	test("stars through gh, or opens the page in the background without it", async () => {
		const withGh = setup({
			usedMs: HOUR,
			gh: { put: { ok: true, stdout: "" }, count: { ok: true, stdout: "311" } },
		});
		await withGh.prompt.status();
		expect(await withGh.prompt.star()).toEqual({ via: "gh" });
		expect(withGh.prompt.state().count).toBe(312);
		expect(withGh.calls.opened).toEqual([]);

		const without = setup({ usedMs: HOUR });
		expect(await without.prompt.star()).toEqual({ via: "browser" });
		expect(without.calls.opened).toEqual([
			"https://github.com/evrendom/opaline",
		]);
		expect((await without.prompt.status()).show).toBe(false);
	});

	test("a dismissed card never comes back, across restarts", async () => {
		const { prompt, fsImpl } = setup({
			usedMs: HOUR,
			gh: { count: { ok: true, stdout: "311" } },
		});
		expect((await prompt.status()).show).toBe(true);
		prompt.dismiss();
		const reopened = createStarPrompt({
			file: "star.json",
			fsImpl,
			gh: async () => ({ ok: false, stdout: "" }),
		});
		expect((await reopened.status()).show).toBe(false);
	});
});
