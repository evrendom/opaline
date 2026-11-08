let compactNumber = compactNumberFormat(undefined);

function compactNumberFormat(locale: string | undefined) {
	return new Intl.NumberFormat(locale, {
		notation: "compact",
		maximumFractionDigits: 1,
	});
}

export function setCompactNumberLocale(locale: string | undefined) {
	compactNumber = compactNumberFormat(locale);
}

export function formatCompactNumber(value: number) {
	return compactNumber.format(value);
}
