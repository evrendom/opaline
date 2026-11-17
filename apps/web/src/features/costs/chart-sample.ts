export function sampleLevels(count: number): number[] {
	return Array.from({ length: count }, (_, index) => {
		const wave =
			0.5 + 0.28 * Math.sin(index * 0.55) + 0.14 * Math.sin(index * 1.7 + 1.3);
		return Math.min(1, Math.max(0.08, wave));
	});
}
