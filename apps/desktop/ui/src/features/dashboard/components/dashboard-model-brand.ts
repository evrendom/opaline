type ModelBadgeTone = {
	chipClassName: string;
	icon: "claude" | "codex" | null;
	identityIconClassName: string;
};

function normalizeModelVersion(version: string | null | undefined) {
	if (!version) {
		return null;
	}

	return version
		.replaceAll(/[-_]/g, ".")
		.replaceAll(/\.+/g, ".")
		.replaceAll(/^\./g, "")
		.replaceAll(/\.$/g, "");
}

function formatFallbackModelLabel(model: string) {
	return model
		.replaceAll(/[-_]+/g, " ")
		.replaceAll(/\s+/g, " ")
		.trim()
		.replaceAll(/\b\w/g, (char) => char.toUpperCase());
}

export function formatModelDisplayLabel(model: string) {
	const normalizedModel = model.trim().toLowerCase();
	if (normalizedModel === "codex") return "Codex";
	if (normalizedModel === "claude (failed start)")
		return "Claude (failed start)";
	const fableVersion = normalizeModelVersion(
		normalizedModel.match(
			/fable[-_ ]?([0-9]+(?:[._-][0-9]{1,2}(?![0-9]))?)/,
		)?.[1],
	);
	if (normalizedModel.includes("fable")) {
		return fableVersion ? `Fable ${fableVersion}` : "Fable";
	}

	const claudeFamilyMatch = normalizedModel.match(/(opus|sonnet|haiku)/);

	if (claudeFamilyMatch) {
		const familyLabel =
			claudeFamilyMatch[1][0]?.toUpperCase() +
			(claudeFamilyMatch[1].slice(1) ?? "");
		const versionAfterFamily = normalizedModel.match(
			/(?:opus|sonnet|haiku)[-_ ]?([0-9]+(?:[._-][0-9]+)?)/,
		)?.[1];
		const versionBeforeFamily = normalizedModel.match(
			/claude[-_ ]?([0-9]+(?:[._-][0-9]+)?(?:[-_][0-9]+(?:\.[0-9]+)?)?)[-_ ]?(?:opus|sonnet|haiku)/,
		)?.[1];
		const version =
			normalizeModelVersion(versionAfterFamily) ??
			normalizeModelVersion(versionBeforeFamily);

		return version ? `${familyLabel} ${version}` : familyLabel;
	}

	if (
		normalizedModel.includes("gpt") ||
		normalizedModel.includes("chatgpt") ||
		normalizedModel.includes("codex")
	) {
		const version = normalizeModelVersion(
			normalizedModel.match(/gpt[-_ ]?([0-9]+(?:[._-][0-9]+)?)/)?.[1] ??
				normalizedModel.match(
					/(?:chatgpt|codex)[-_ ]?([0-9]+(?:[._-][0-9]+)?)/,
				)?.[1],
		);

		const variant = normalizedModel.match(
			/(?:^|[-_ ])(sol|terra|luna|astra)(?=$|[-_ ])/,
		)?.[1];
		const label = version ? `GPT ${version}` : "GPT";
		return variant ? `${label} ${formatFallbackModelLabel(variant)}` : label;
	}

	return formatFallbackModelLabel(model);
}

export function getModelBadgeTone(model: string): ModelBadgeTone {
	const normalizedModel = model.toLowerCase();

	if (
		normalizedModel.includes("claude") ||
		/(?:^|[\s/:_-])(?:sonnet|opus|haiku)(?:$|[\s/:_-])/u.test(
			normalizedModel,
		) ||
		normalizedModel.includes("fable") ||
		normalizedModel.includes("mythos")
	) {
		return {
			chipClassName: "border-line bg-surface text-ink shadow-none",
			icon: "claude",
			identityIconClassName: "text-[#CC7D5E]",
		};
	}

	if (normalizedModel.includes("codex")) {
		return {
			chipClassName: "border-line bg-surface text-ink shadow-none",
			icon: "codex",
			identityIconClassName: "text-ink",
		};
	}

	if (
		normalizedModel.includes("chatgpt") ||
		normalizedModel.includes("gpt") ||
		/(?:^|[\s/:_-])o[134](?:$|[\s/:_-])/u.test(normalizedModel)
	) {
		return {
			chipClassName: "border-line bg-surface text-ink shadow-none",
			icon: "codex",
			identityIconClassName: "text-ink",
		};
	}

	return {
		chipClassName: "border-accent-tint bg-accent-tint text-accent",
		icon: null,
		identityIconClassName: "",
	};
}

export function getModelBrandChip(
	model: string | undefined,
): { glyphClassName: string; tint: string } | null {
	const icon = model ? getModelBadgeTone(model).icon : null;
	if (icon === "claude") {
		return { glyphClassName: "text-[#D97757]", tint: "#D97757" };
	}
	if (icon === "codex") {
		return { glyphClassName: "text-ink", tint: "#10A37F" };
	}
	return null;
}
