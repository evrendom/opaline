import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { orgMiddleware, os } from "../../middleware.js";
import { readR2IngestAvailability } from "../../services/r2-ingest-storage.service.js";
import {
	createR2ImageUrlSigner,
	readSessionImage,
} from "../../services/session-image-read.service.js";
import { getSessionOwner } from "../../services/session-ownership.service.js";
import { requireSessionDetailOwnerAccess } from "./session-detail-access.js";

let signer: ReturnType<typeof createR2ImageUrlSigner> | undefined;

/**
 * An image of a session (a screenshot or pasted image, by its marker's
 * sha256), readable exactly like the session's detail: by the session's
 * owner, or by every member unless the workspace is limited to own sessions.
 */
const get = os.analytics.images.get
	.use(orgMiddleware)
	.handler(async ({ input, context, signal }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionOwner(context.organizationId, input.sessionId),
			context.sessionReader,
		);
		return readSessionImage(
			{ ...input, organizationId: context.organizationId, ownerId },
			{
				clickhouse: getClickhouse(),
				database: sqlClient,
				signUrl: () => {
					if (signer) return signer;
					const availability = readR2IngestAvailability();
					if (!availability.enabled) return null;
					signer = createR2ImageUrlSigner(availability.configuration);
					return signer;
				},
				signal,
			},
		);
	});

export const imagesRouter = os.analytics.images.router({ get });
