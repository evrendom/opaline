import { mkdir, rename } from "node:fs/promises";
import {
	TRENDS_USAGE_PATH,
	type TrendsUsageCapture,
	trendsUsageCaptureSchema,
	trendsUsageSchema,
} from "../../packages/api-routes/src/trends-usage";

const OUTPUT = new URL(
	"../../apps/marketing/src/trends/generated/opaline-usage.json",
	import.meta.url,
);

/** `TRENDS_USAGE_API_URL` points at another API, e.g. local development. */
export function trendsUsageUrl() {
	return new URL(
		TRENDS_USAGE_PATH,
		process.env.TRENDS_USAGE_API_URL ?? "https://opaline.so",
	).href;
}

export async function fetchOpalineUsage(): Promise<TrendsUsageCapture> {
	const sourceUrl = trendsUsageUrl();
	const response = await fetch(sourceUrl, {
		headers: { "User-Agent": "OpalineTrends/1.0 (+https://opaline.so/trends)" },
		signal: AbortSignal.timeout(120_000),
		redirect: "error",
	});
	if (!response.ok)
		throw new Error(`Opaline usage fetch failed: HTTP ${response.status}`);
	const capture = trendsUsageCaptureSchema.parse({
		fetchedAt: new Date().toISOString(),
		sourceUrl,
		usage: trendsUsageSchema.parse(await response.json()),
	});
	await writeUsageCapture(capture);
	console.log(
		`Opaline usage: ${capture.usage.periodStart} to ${capture.usage.periodEndExclusive} (exclusive); ${capture.usage.models.length} published models of ${capture.usage.totals.runs} runs; generated ${capture.usage.generatedAt}.`,
	);
	return capture;
}

/** Writes a capture where the marketing build reads it, atomically. */
export async function writeUsageCapture(capture: TrendsUsageCapture) {
	await mkdir(new URL(".", OUTPUT), { recursive: true });
	const temporary = new URL("opaline-usage.json.tmp", OUTPUT);
	await Bun.write(temporary, `${JSON.stringify(capture, null, 2)}\n`);
	await rename(temporary, OUTPUT);
}

if (import.meta.main) await fetchOpalineUsage();
