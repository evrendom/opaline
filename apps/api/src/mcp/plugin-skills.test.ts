import { expect, test } from "bun:test";
import { join } from "node:path";
import { Glob } from "bun";

const SKILLS = join(import.meta.dir, "../../../../plugins/opaline/skills");

test("every plugin skill's front matter is valid YAML with a name and a description", async () => {
	const files = [...new Glob("*/SKILL.md").scanSync(SKILLS)].sort();
	expect(files).toEqual(["opaline/SKILL.md", "setup/SKILL.md"]);
	for (const file of files) {
		const text = await Bun.file(join(SKILLS, file)).text();
		const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
		expect({ file, frontMatter: Boolean(match) }).toEqual({
			file,
			frontMatter: true,
		});
		const parsed = Bun.YAML.parse(match?.[1] ?? "") as Record<string, unknown>;
		expect({
			file,
			name: typeof parsed.name,
			description: typeof parsed.description,
		}).toEqual({ file, name: "string", description: "string" });
		expect(`${parsed.description}`.length).toBeGreaterThan(20);
	}
});

const PLUGIN = join(import.meta.dir, "../../../../plugins/opaline");

test("the Claude Code manifest matches the Codex manifest", async () => {
	const codex = await Bun.file(
		join(PLUGIN, ".codex-plugin/plugin.json"),
	).json();
	const claude = await Bun.file(
		join(PLUGIN, ".claude-plugin/plugin.json"),
	).json();
	for (const key of ["name", "version", "description", "license"]) {
		expect({ key, value: claude[key] }).toEqual({ key, value: codex[key] });
	}
});

test("the Claude Code marketplace lists the plugin", async () => {
	const marketplace = await Bun.file(
		join(PLUGIN, "../../.claude-plugin/marketplace.json"),
	).json();
	expect(marketplace.plugins).toContainEqual(
		expect.objectContaining({ name: "opaline", source: "./plugins/opaline" }),
	);
});
