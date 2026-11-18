import { mkdir, rename } from "node:fs/promises";
import { fetchT3Release } from "../../packages/api-routes/src/trends-source-fetch";
import {
	type T3UsageRelease,
	t3UsageReleaseSchema,
} from "../../packages/api-routes/src/trends-t3-usage";

export {
	T3_SOURCE_URL,
	toT3UsageRelease,
} from "../../packages/api-routes/src/trends-source-fetch";

const OUTPUT = new URL(
	"../../apps/marketing/src/trends/generated/t3-usage.json",
	import.meta.url,
);

export async function fetchT3Usage(): Promise<T3UsageRelease> {
	const cached = Bun.file(OUTPUT);
	if (await cached.exists()) {
		const release = t3UsageReleaseSchema.safeParse(await cached.json());
		if (
			release.success &&
			release.data.fetchedAt.slice(0, 10) ===
				new Date().toISOString().slice(0, 10)
		) {
			console.log("T3: reusing today's validated capture (no requests).");
			report(release.data);
			return release.data;
		}
	}
	const release = await fetchT3Release();
	await writeT3Release(release);
	report(release);
	return release;
}

/** Writes a capture where the marketing build reads it, atomically. */
export async function writeT3Release(release: T3UsageRelease) {
	await mkdir(new URL(".", OUTPUT), { recursive: true });
	const temporary = new URL("t3-usage.json.tmp", OUTPUT);
	await Bun.write(temporary, `${JSON.stringify(release, null, 2)}\n`);
	await rename(temporary, OUTPUT);
}

function report(release: T3UsageRelease) {
	console.log(
		`T3: ${release.upstream.start} to ${release.upstream.endExclusive} (exclusive); ${release.sent.length} harness-days, ${release.metrics.length} model rows; upstream fetched ${release.upstream.fetchedAt}.`,
	);
}

if (import.meta.main) await fetchT3Usage();
