import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import type {
	ObjectStoreClient,
	R2IngestConfiguration,
} from "./r2-ingest-storage.service.js";

export const ABANDONED_INGEST_OBJECT_PREFIX = "ingest/";
export const ABANDONED_OBJECT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const SCRATCH_MAX_AGE_MS = 24 * 60 * 60_000;
const LIST_PAGE_KEYS = 1_000;
const MAX_LISTED_OBJECTS_PER_SWEEP = 100_000;

export type SweepableObjectStore = Pick<
	ObjectStoreClient,
	| "abortMultipartUpload"
	| "deleteObjects"
	| "incompleteMultipartUploads"
	| "listObjects"
	| "removeStaleScratch"
>;

export interface ObjectStoreSweepResult {
	readonly abortedUploads: number;
	readonly deletedObjects: number;
	readonly hasMore: boolean;
	readonly listedObjects: number;
	readonly removedScratch: number;
}

export function needsObjectStoreSweep(
	configuration: R2IngestConfiguration,
): boolean {
	return configuration.backend === "local" || configuration.backend === "s3";
}

export async function sweepObjectStore(input: {
	readonly deadline?: MaintenanceDeadline;
	readonly now: Date;
	readonly store: SweepableObjectStore;
}): Promise<ObjectStoreSweepResult> {
	const expiredBefore = input.now.getTime() - ABANDONED_OBJECT_MAX_AGE_MS;
	let hasMore = false;
	let listedObjects = 0;
	let deletedObjects = 0;
	let continuationToken: string | undefined;
	do {
		if (
			!hasMaintenanceTimeRemaining(input.deadline) ||
			listedObjects >= MAX_LISTED_OBJECTS_PER_SWEEP
		) {
			hasMore = true;
			break;
		}
		const page = await input.store.listObjects({
			continuationToken,
			maxKeys: LIST_PAGE_KEYS,
			prefix: ABANDONED_INGEST_OBJECT_PREFIX,
		});
		listedObjects += page.objects.length;
		const expired = page.objects
			.filter((object) => object.lastModified.getTime() < expiredBefore)
			.map((object) => object.key);
		if (expired.length > 0) {
			await input.store.deleteObjects(expired);
			deletedObjects += expired.length;
		}
		continuationToken = page.nextContinuationToken ?? undefined;
	} while (continuationToken);

	let abortedUploads = 0;
	for await (const upload of input.store.incompleteMultipartUploads()) {
		if (!hasMaintenanceTimeRemaining(input.deadline)) {
			hasMore = true;
			break;
		}
		if (upload.initiatedAt.getTime() >= expiredBefore) continue;
		try {
			await input.store.abortMultipartUpload({
				objectKey: upload.objectKey,
				uploadId: upload.uploadId,
			});
			abortedUploads += 1;
		} catch (error) {
			if (!isNoSuchUpload(error)) throw error;
		}
	}

	const removedScratch = input.store.removeStaleScratch
		? await input.store.removeStaleScratch(
				new Date(input.now.getTime() - SCRATCH_MAX_AGE_MS),
			)
		: 0;
	return {
		abortedUploads,
		deletedObjects,
		hasMore,
		listedObjects,
		removedScratch,
	};
}

function isNoSuchUpload(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	return ["name", "code", "Code"].some(
		(key) => Reflect.get(error, key) === "NoSuchUpload",
	);
}
