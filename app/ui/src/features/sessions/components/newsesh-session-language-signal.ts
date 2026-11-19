export interface NewseshLanguageSignalMatch {
	readonly category: "apology" | "positive" | "swear";
	readonly matchedText: string;
	readonly speaker: "member" | "model";
}

type LanguageSignalCountSource = {
	readonly [key: `${string}_${"swears" | "apologies" | "positive"}`]: number;
};

type LanguageSignalMatchKey = `${"member" | "model"}_${
	| "swear"
	| "apology"
	| "positive"}_matches`;

type LanguageSignalMatchSource = LanguageSignalCountSource &
	Partial<Record<LanguageSignalMatchKey, readonly string[]>>;

const NEWSHESH_LANGUAGE_SIGNAL_ORDER: ReadonlyArray<{
	category: NewseshLanguageSignalMatch["category"];
	countKey:
		| "member_swears"
		| "member_apologies"
		| "member_positive"
		| "model_apologies";
	matchKey: LanguageSignalMatchKey;
	speaker: NewseshLanguageSignalMatch["speaker"];
}> = [
	{
		category: "swear",
		countKey: "member_swears",
		matchKey: "member_swear_matches",
		speaker: "member",
	},
	{
		category: "apology",
		countKey: "member_apologies",
		matchKey: "member_apology_matches",
		speaker: "member",
	},
	{
		category: "positive",
		countKey: "member_positive",
		matchKey: "member_positive_matches",
		speaker: "member",
	},
	{
		category: "apology",
		countKey: "model_apologies",
		matchKey: "model_apology_matches",
		speaker: "model",
	},
];

export function getNewseshLanguageSignalMatches(
	session: LanguageSignalMatchSource,
	speaker?: NewseshLanguageSignalMatch["speaker"],
): NewseshLanguageSignalMatch[] {
	return NEWSHESH_LANGUAGE_SIGNAL_ORDER.map((signal, order) => ({
		...signal,
		count: session[signal.countKey],
		matches: session[signal.matchKey] ?? [],
		order,
	}))
		.filter(
			(signal) =>
				signal.matches.length > 0 && (!speaker || signal.speaker === speaker),
		)
		.sort((left, right) => right.count - left.count || left.order - right.order)
		.flatMap((signal): NewseshLanguageSignalMatch[] => {
			return signal.matches.map((matchedText) => ({
				category: signal.category,
				matchedText,
				speaker: signal.speaker,
			}));
		});
}
