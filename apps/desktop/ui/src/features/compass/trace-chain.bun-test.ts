import { describe, expect, test } from "bun:test";
import { getChainRest } from "./trace-chain";

describe("a shell chain's time", () => {
	test("a script that edits a file, then checks and renders: the time is the check's", () => {
		const chain = getChainRest(
			[
				"python3 -I - <<'EOF'",
				"open('src/components/artwork/globe3d.ts','w').write('x')",
				"EOF",
				'pnpm astro check 2>&1 | grep -E "error|warning" -A3 | head -8; sleep 2; node run.mjs | head -1 && ffmpeg -y -i a.png b.png',
			].join("\n"),
		);
		expect(chain?.lane).toBe("verify");
		expect(chain?.filesFirst).toBe(true);
		expect(chain?.parts[1]).toContain("pnpm astro check");
	});

	test("file work alone keeps its own time", () => {
		expect(getChainRest("sed -i '' 's/a/b/' x.ts")).toBeNull();
		expect(getChainRest("cat a.ts | grep foo")).toBeNull();
		expect(getChainRest("cd src && echo done > log.txt")).toBeNull();
	});

	test("a check before the file work, and plain shell after", () => {
		expect(getChainRest("bun test x.test.ts && cat out.log")).toMatchObject({
			filesFirst: false,
			lane: "verify",
		});
		expect(getChainRest("cat a.ts; node build.mjs")?.lane).toBe("shell");
	});
});
