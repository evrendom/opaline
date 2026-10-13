import { R2_INGEST_BUCKET } from "../../services/r2-ingest-storage.service.js";
import type { FakeEvidenceR2 } from "./fake-evidence-r2.js";

/**
 * A loopback S3 endpoint over `FakeEvidenceR2` for code that builds its own
 * R2 client from the environment (`R2_ENDPOINT`, honoured only in tests):
 * single-object PUT and GET, batch DELETE and ListObjectsV2. GETs are
 * recorded in `r2.readKeys`.
 */
export function startFakeR2S3Endpoint(
	r2: FakeEvidenceR2,
): Bun.Server<undefined> {
	return Bun.serve({
		async fetch(request) {
			const url = new URL(request.url);
			const objectKey = readObjectKey(url);
			if (
				request.method === "POST" &&
				url.searchParams.has("delete") &&
				objectKey === null
			) {
				const body = await request.text();
				await r2.deleteObjects(
					[...body.matchAll(/<Key>([^<]+)<\/Key>/gu)].map((match) =>
						decodeXmlText(match[1] ?? ""),
					),
				);
				return new Response(
					'<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/" />',
					{ headers: { "Content-Type": "application/xml" } },
				);
			}
			if (
				request.method === "GET" &&
				objectKey === null &&
				url.searchParams.get("list-type") === "2"
			) {
				const listing = await r2.listObjects({
					continuationToken:
						url.searchParams.get("continuation-token") ?? undefined,
					maxKeys: Number(url.searchParams.get("max-keys") ?? 1_000),
					prefix: url.searchParams.get("prefix") ?? "",
					startAfter: url.searchParams.get("start-after") ?? undefined,
				});
				const contents = listing.objects
					.map(
						(object) =>
							`<Contents><Key>${escapeXml(object.key)}</Key><LastModified>${object.lastModified.toISOString()}</LastModified><Size>0</Size></Contents>`,
					)
					.join("");
				const next = listing.nextContinuationToken
					? `<IsTruncated>true</IsTruncated><NextContinuationToken>${escapeXml(listing.nextContinuationToken)}</NextContinuationToken>`
					: "<IsTruncated>false</IsTruncated>";
				return new Response(
					`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${R2_INGEST_BUCKET}</Name>${next}${contents}</ListBucketResult>`,
					{ headers: { "Content-Type": "application/xml" } },
				);
			}
			if (objectKey === null) return new Response(null, { status: 404 });
			if (request.method === "PUT") {
				await r2.putObject({
					body: new Uint8Array(await request.arrayBuffer()),
					metadata: {},
					objectKey,
				});
				return new Response(null, {
					headers: { ETag: '"fake-etag"' },
					status: 200,
				});
			}
			if (request.method === "GET") {
				const stored = r2.objects.get(objectKey);
				if (stored) await r2.getObject(objectKey);
				if (!stored) {
					return new Response(
						"<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>",
						{ headers: { "Content-Type": "application/xml" }, status: 404 },
					);
				}
				return new Response(stored.bytes, {
					headers: {
						"Content-Length": stored.bytes.byteLength.toString(),
						ETag: '"fake-etag"',
					},
				});
			}
			return new Response(null, { status: 405 });
		},
		hostname: "127.0.0.1",
		port: 0,
	});
}

function readObjectKey(url: URL): string | null {
	const bucketPath = `/${R2_INGEST_BUCKET}`;
	if (!url.pathname.startsWith(`${bucketPath}/`)) return null;
	const key = url.pathname.slice(bucketPath.length + 1);
	return key ? decodeURIComponent(key) : null;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function decodeXmlText(value: string): string {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'");
}
