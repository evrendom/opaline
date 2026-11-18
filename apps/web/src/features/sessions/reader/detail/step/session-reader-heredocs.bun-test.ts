import { describe, expect, test } from "bun:test";
import { getHeredocs } from "./session-reader-heredocs";

describe("heredocs", () => {
	test("a script fed to python reads as python", () => {
		const [script] = getHeredocs(
			"python3 - <<'EOF'\nimport re\nprint(re)\nEOF\nsed -n 1,2p a.astro",
		);
		expect(script).toEqual({
			body: "import re\nprint(re)",
			language: "python",
			lead: "python3 -",
		});
	});

	test("a file written with cat takes the file's language", () => {
		const [file] = getHeredocs(
			'cat > src/a.ts <<"TS"\nexport const a = 1;\nTS',
		);
		expect(file?.language).toBe("typescript");
		expect(file?.body).toBe("export const a = 1;");
	});

	test("an indented closer ends a <<- heredoc; none, none", () => {
		expect(getHeredocs("cat <<-END\n\tline\n\tEND")[0]?.body).toBe("\tline");
		expect(getHeredocs("echo 'a << b'")).toEqual([]);
	});
});
