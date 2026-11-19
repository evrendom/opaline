import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	ARTIFACT_LAYOUT,
	layoutEnvironment,
	readArtifactManifest,
	resolveServerLayout,
} from "./layout.js";

const manifest = {
	name: "@opalinehq/server",
	version: "1.2.3",
	entry: ARTIFACT_LAYOUT.entry,
	webDir: ARTIFACT_LAYOUT.webDir,
	minimumBun: "1.3.8",
	builtAt: "2026-11-08T00:00:00.000Z",
	commit: "abc",
};

function artifact(withWeb: boolean): string {
	const root = mkdtempSync(join(tmpdir(), "opaline-artifact-"));
	mkdirSync(join(root, "server"));
	writeFileSync(join(root, ARTIFACT_LAYOUT.manifest), JSON.stringify(manifest));
	if (withWeb) {
		mkdirSync(join(root, ARTIFACT_LAYOUT.webDir), { recursive: true });
		writeFileSync(join(root, ARTIFACT_LAYOUT.webDir, "index.html"), "");
	}
	return root;
}

test("a checkout runs its sources and serves no web app unless told to", () => {
	const layout = resolveServerLayout(import.meta.dir);
	const checkout = resolve(import.meta.dir, "../../../../..");
	expect(layout).toEqual({
		kind: "checkout",
		root: checkout,
		version: null,
		webDir: null,
		postgresMigrateScript: join(checkout, "packages/sql-schema/src/migrate.ts"),
		clickHouseSchemaDir: join(checkout, "packages/ch-schema"),
	});
});

test("an artifact runs its bundled scripts and serves its own web app", () => {
	const root = artifact(true);
	expect(resolveServerLayout(join(root, "server"))).toEqual({
		kind: "artifact",
		root,
		version: "1.2.3",
		webDir: join(root, ARTIFACT_LAYOUT.webDir),
		postgresMigrateScript: join(root, ARTIFACT_LAYOUT.postgresMigrate),
		clickHouseSchemaDir: join(root, ARTIFACT_LAYOUT.clickHouseSchemaDir),
	});
});

test("an artifact without a web build runs API only", () => {
	expect(resolveServerLayout(join(artifact(false), "server")).webDir).toBe(
		null,
	);
});

test("environment wins over the artifact's version and web directory", () => {
	const layout = resolveServerLayout(join(artifact(true), "server"));
	expect(layoutEnvironment({}, layout)).toEqual({
		OPALINE_VERSION: "1.2.3",
		OPALINE_WEB_DIR: layout.webDir ?? "",
	});
	expect(
		layoutEnvironment(
			{ OPALINE_VERSION: "9.9.9", OPALINE_WEB_DIR: "/srv/web" },
			layout,
		),
	).toEqual({});
});

test("a manifest names the server package and every field", () => {
	expect(() => readArtifactManifest("{", "m.json")).toThrow(
		"m.json is not valid JSON",
	);
	expect(() =>
		readArtifactManifest(JSON.stringify({ ...manifest, entry: "" }), "m.json"),
	).toThrow("m.json has no entry");
	expect(() =>
		readArtifactManifest(
			JSON.stringify({ ...manifest, name: "other" }),
			"m.json",
		),
	).toThrow("m.json describes other, not @opalinehq/server");
});
