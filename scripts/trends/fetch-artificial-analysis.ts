import { mkdir, rename } from "node:fs/promises";
import { resolveAaVariant } from "../../packages/api-routes/src/model-registry";
import {
	type AaRelease,
	aaReleaseSchema,
} from "../../packages/api-routes/src/trends-aa-release";
import { fetchAaRelease } from "../../packages/api-routes/src/trends-source-fetch";

export { discoverManifest } from "../../packages/api-routes/src/trends-source-fetch";

const OUTPUT = new URL(
	"../../apps/marketing/src/trends/generated/aa-release.json",
	import.meta.url,
);

export async function fetchArtificialAnalysis(): Promise<AaRelease> {
	const cached = Bun.file(OUTPUT);
	if (await cached.exists()) {
		const release = aaReleaseSchema.safeParse(await cached.json());
		if (
			release.success &&
			release.data.fetchedAt.slice(0, 10) ===
				new Date().toISOString().slice(0, 10)
		) {
			console.log("AA: reusing today's validated release (no requests).");
			reportCoverage(release.data);
			return release.data;
		}
	}
	const release = await fetchAaRelease();
	await writeAaRelease(release);
	reportCoverage(release);
	return release;
}

/** Writes a release where the marketing build reads it, atomically. */
export async function writeAaRelease(release: AaRelease) {
	await mkdir(new URL(".", OUTPUT), { recursive: true });
	const temporary = new URL("aa-release.json.tmp", OUTPUT);
	await Bun.write(temporary, `${JSON.stringify(release, null, 2)}\n`);
	await rename(temporary, OUTPUT);
}

function reportCoverage(release: AaRelease) {
	const unmapped = release.records.filter(
		(record) => resolveAaVariant(record) === null,
	);
	console.log(
		`AA: ${release.records.length} variants; ${release.records.length - unmapped.length} registry-mapped; ${unmapped.length} uncatalogued (eligible for release-derived top 20 by exact source identity); index ${release.indexVersion ?? "unknown"}; fetched ${release.fetchedAt}.`,
	);
	console.log(
		`Unmapped AA variants: ${unmapped.map((record) => record.slug).join(", ")}`,
	);
}

if (import.meta.main) await fetchArtificialAnalysis();
