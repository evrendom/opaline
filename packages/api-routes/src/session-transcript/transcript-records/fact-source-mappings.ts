import type {
	FactMapping,
	FactSourceMapping,
	MappingRelation,
} from "./fact-mapping-types.js";

export function primaryRelation(
	sources: readonly FactSourceMapping[],
	fallback: MappingRelation,
): MappingRelation {
	if (fallback.kind === "derived" || fallback.kind === "provenance")
		return fallback;
	const primary = sources.filter((source) => source.role === "primary");
	if (primary.length === 0) return fallback;
	const relations = primary.map((source) => source.relation);
	if (relations.some((relation) => relation.kind === "unreviewed"))
		return { kind: "unreviewed" };
	if (relations.every((relation) => relation.kind === relations[0]?.kind))
		return relations[0] ?? fallback;
	if (
		relations.every(
			(relation) => relation.kind === "exact" || relation.kind === "transform",
		)
	)
		return {
			kind: "transform",
			transform: [
				...new Set(
					relations.flatMap((relation) =>
						relation.kind === "transform" ? [relation.transform] : [],
					),
				),
			].join("; "),
		};
	return { kind: "close" };
}

export function mapFactSources(
	paths: readonly string[],
	mapping: Partial<FactMapping>,
	gapPaths: readonly string[] = [],
) {
	const fallback: MappingRelation = mapping.relation ?? { kind: "unreviewed" };
	const overrides = mapping.sourceMappings ?? [];
	const all = [...new Set([...paths, ...gapPaths])];
	for (const override of overrides)
		if (!all.includes(override.path))
			throw new Error(
				`Source judgement without a declared path: ${override.path}`,
			);
	const sourceMappings: FactSourceMapping[] = all.map((path) => {
		const override = overrides.find((source) => source.path === path);
		if (override !== undefined) return override;
		const gap = !paths.includes(path);
		return {
			path,
			role: "primary",
			relation: gap ? { kind: "unreviewed" } : fallback,
			...(gap
				? {
						justification: "Recorded gap; not extracted by the current parser.",
					}
				: mapping.justification === undefined
					? {}
					: { justification: mapping.justification }),
		};
	});
	const current = sourceMappings.filter((source) =>
		paths.includes(source.path),
	);
	return {
		sources: current
			.filter((source) => source.role === "primary")
			.map((source) => source.path),
		sourceMappings,
		relation: primaryRelation(current, fallback),
	};
}
