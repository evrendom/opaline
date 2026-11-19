import { formatHalfHours } from "@/lib/format";

// Table number/time formatting shared by the dashboard list pages.

const usdFormatters = new Map<string, Intl.NumberFormat>();
function usdFormatter(minDecimals: number, maxDecimals: number) {
	const key = `${minDecimals}:${maxDecimals}`;
	let f = usdFormatters.get(key);
	if (!f) {
		f = new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: minDecimals,
			maximumFractionDigits: maxDecimals,
		});
		usdFormatters.set(key, f);
	}
	return f;
}

/** A cost value; `null`/`undefined` → em dash (unpriced, never $0). `maxDecimals`
 * caps the fractional digits; trailing zeros are trimmed back to 2 decimals. */
export function formatCost(
	value: number | null | undefined,
	maxDecimals = 6,
): string {
	if (value === null || value === undefined) return "—";
	return usdFormatter(2, maxDecimals).format(value);
}

/** A cost value padded to exactly `decimals` fraction digits, so a column of
 * them lines up on the decimal point instead of raggedly trimming trailing
 * zeros. `null`/`undefined` → em dash (unpriced, never $0). */
export function formatCostFixed(
	value: number | null | undefined,
	decimals: number,
): string {
	if (value === null || value === undefined) return "—";
	return usdFormatter(decimals, decimals).format(value);
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact" });
const plain = new Intl.NumberFormat("en-US");

// Counts round first: they are integers by definition.
export function formatCount(value: number): string {
	const n = Math.round(value);
	return n >= 1000 ? compact.format(n) : plain.format(n);
}

export function formatTokens(value: number): string {
	return compact.format(value);
}

/** ClickHouse DateTime strings ('YYYY-MM-DD HH:MM:SS', UTC) or ISO → Date. */
export function parseDateTime(value: string | Date): Date {
	if (value instanceof Date) return value;

	const normalized = value.replace(" ", "T");
	const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/iu.test(normalized);
	return new Date(hasTimezone ? normalized : `${normalized}Z`);
}

export function formatRelative(
	value: string | Date | null | undefined,
): string {
	if (!value) return "—";
	const d = parseDateTime(value);
	const diff = Date.now() - d.getTime();
	if (Number.isNaN(diff)) return String(value);
	// Clamp clock skew: a server timestamp slightly ahead of the client must not
	// render as "-3s ago".
	const sec = Math.max(0, Math.round(diff / 1000));
	if (sec < 60) return `${sec}s ago`;
	const min = Math.round(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	return `${Math.round(hr / 24)}d ago`;
}

export function formatPercent(fraction: number | null | undefined): string {
	if (fraction === null || fraction === undefined) return "—";
	return `${Math.round(fraction * 100)}%`;
}

/** Milliseconds → human duration (µs/ms/s/m/h/d). */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms)) return "—";
	// Exact zero reads as "0s" everywhere — e.g. axes anchored at the origin.
	if (ms === 0) return "0s";
	if (ms < 1) return `${Math.round(ms * 1000)}µs`;
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
	// Beyond a minute, build from the largest non-zero unit and show at most two
	// components so e.g. an even hour reads "1h", not "60m 0s".
	const totalSec = Math.round(ms / 1000);
	if (totalSec >= 3600 && totalSec < 86_400) return formatHalfHours(totalSec);
	const d = Math.floor(totalSec / 86_400);
	const h = Math.floor((totalSec % 86_400) / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const sec = totalSec % 60;
	const parts = [];
	if (d) parts.push(`${d}d`);
	if (h) parts.push(`${h}h`);
	if (m) parts.push(`${m}m`);
	if (sec) parts.push(`${sec}s`);
	return parts.slice(0, 2).join(" ") || "0s";
}

/** ClickHouse DateTime strings ('YYYY-MM-DD HH:MM:SS', UTC) or ISO → local. */
export function formatDateTime(
	value: string | Date | null | undefined,
): string {
	if (!value) return "—";
	const d = parseDateTime(value);
	if (Number.isNaN(d.getTime())) return String(value);
	return d.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
