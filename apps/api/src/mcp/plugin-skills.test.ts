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

/** Phrases that tell the agent a member sees only their own sessions. */
const OWN_SESSIONS_ONLY =
	/(their|your) own sessions|members:? (see |analyze |count )?(only )?their own|admins (all|see|count|can analyze)|admins: the whole team|only session owners and workspace admins/i;

test("no skill or manifest says members see only their own sessions; answers still never single out or rank people", async () => {
	const texts = [
		...[...new Glob("*/SKILL.md").scanSync(SKILLS)].map((file) =>
			join(SKILLS, file),
		),
		join(PLUGIN, ".codex-plugin/plugin.json"),
		join(PLUGIN, ".claude-plugin/plugin.json"),
	];
	const claims: [string, string][] = [];
	for (const path of texts) {
		const match = (await Bun.file(path).text()).match(OWN_SESSIONS_ONLY);
		if (match) claims.push([path.slice(PLUGIN.length), match[0]]);
	}
	expect(claims).toEqual([]);
	const skill = await Bun.file(join(SKILLS, "opaline/SKILL.md")).text();
	expect(skill).toContain("Every member sees every member's sessions");
	expect(skill).toContain("Don't single out or rank people");
});
