const SAMPLE_POINTS = 24;
const DAY_MS = 86_400_000;

export function sampleLevels(count = SAMPLE_POINTS): number[] {
	return Array.from({ length: count }, (_, index) => {
		const wave = 0.5 + 0.5 * Math.sin(index / 2.6);
		const jitter = ((index * 7919) % 13) / 13;
		return (180 + wave * 520 + jitter * 140) / 840;
	});
}

export function sampleDates(end: string, count = SAMPLE_POINTS): string[] {
	const last = Date.parse(`${end}T00:00:00Z`);
	return Array.from({ length: count }, (_, index) =>
		new Date(last - (count - 1 - index) * DAY_MS).toISOString().slice(0, 10),
	);
}
