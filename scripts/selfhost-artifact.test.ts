import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	checkReferences,
	createTar,
	digests,
	inlineScripts,
	packDirectory,
	relativeUrlReferences,
} from "./selfhost-artifact";

test("the tarball unpacks with tar into package/ with every file intact", async () => {
	const source = mkdtempSync(join(tmpdir(), "artifact-src-"));
	const long = `${"d".repeat(60)}/${"e".repeat(60)}/${"f".repeat(30)}.js`;
	mkdirSync(join(source, long, ".."), { recursive: true });
	writeFileSync(join(source, long), "long path");
	mkdirSync(join(source, "server"));
	writeFileSync(join(source, "server/main.js"), "x".repeat(1500));
	writeFileSync(join(source, "empty.txt"), "");
	const tarball = await packDirectory(source);
	const tgz = join(mkdtempSync(join(tmpdir(), "artifact-out-")), "a.tgz");
	writeFileSync(tgz, tarball);
	const target = mkdtempSync(join(tmpdir(), "artifact-x-"));
	const extract = Bun.spawnSync(["tar", "-xzf", tgz, "-C", target]);
	expect(extract.exitCode).toBe(0);
	expect(readFileSync(join(target, "package", long), "utf8")).toBe(
		"long path",
	);
	expect(readFileSync(join(target, "package/server/main.js"), "utf8")).toBe(
		"x".repeat(1500),
	);
	expect(readFileSync(join(target, "package/empty.txt"), "utf8")).toBe("");
	expect(await packDirectory(source)).toEqual(tarball);
});

test("archive paths stay relative", () => {
	for (const path of ["/etc/passwd", "package/../x", "package//x"])
		expect(() =>
			createTar([{ path, bytes: new Uint8Array() }]),
		).toThrow("refusing to archive");
});

test("digests match npm's sha512 integrity and a hex sha256", () => {
	const { sha256, integrity } = digests(new TextEncoder().encode("abc"));
	expect(sha256).toBe(
		"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
	);
	expect(integrity).toBe(
		"sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==",
	);
});

test("relative file URLs in a bundle are found, and .ts workers get a shim to their bundle", () => {
	const references = relativeUrlReferences(`
		new Worker(new URL("./a.worker.js", import.meta.url).href);
		new Worker(new URL("./b.worker.ts", import.meta.url).href);
		readFile(new URL('../assets/font.ttf', import.meta.url));
		new URL(\`./\${name}\`, import.meta.url);
		new URL("https://example.com/x", import.meta.url);
	`);
	expect(references).toEqual([
		"../assets/font.ttf",
		"./a.worker.js",
		"./b.worker.ts",
	]);
	const present = new Set(["/pkg/server/a.worker.js", "/pkg/server/b.worker.js"]);
	expect(
		checkReferences("/pkg/server", references, (path) => present.has(path)),
	).toEqual({
		missing: ["../assets/font.ttf"],
		shims: [
			{ path: "/pkg/server/b.worker.ts", target: "./b.worker.js" },
		],
	});
});

test("inline scripts are reported, external and data scripts are not", () => {
	expect(
		inlineScripts(
			'<script src="/a.js"></script><script type="application/json">{}</script><script>boot()</script><script> </script>',
		),
	).toEqual(["<script>boot()</script>"]);
});
