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
