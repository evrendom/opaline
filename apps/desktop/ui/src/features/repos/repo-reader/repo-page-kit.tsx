/** A dollar amount as the repo pages show it: "$0", "<$1", "$4.2", "$1,204". */
export function money(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "$0";
	if (value < 1) return "<$1";
	if (value < 100) return `$${value.toFixed(value < 10 ? 1 : 0)}`;
	return `$${Math.round(value).toLocaleString("en-US")}`;
}
