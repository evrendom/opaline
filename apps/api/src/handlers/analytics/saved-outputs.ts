import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { orgMiddleware, os } from "../../middleware.js";
import {
	createR2MultipartUploadClient,
	readR2IngestAvailability,
} from "../../services/r2-ingest-storage.service.js";
import { getSessionOwner } from "../../services/session-ownership.service.js";
import { readSessionSavedOutput } from "../../services/session-saved-output-read.service.js";
import { requireSessionDetailOwnerAccess } from "./session-detail-access.js";

/**
 * A session's saved output (background task output, large tool output),
 * readable exactly like the session's detail: by the session's owner, or by
 * every member unless the workspace is limited to own sessions.
 */
const get = os.analytics.savedOutputs.get
	.use(orgMiddleware)
	.handler(async ({ input, context, signal }) => {
		const ownerId = requireSessionDetailOwnerAccess(
			await getSessionOwner(context.organizationId, input.sessionId),
			context.sessionReader,
		);
		return readSessionSavedOutput(
			{ ...input, organizationId: context.organizationId, ownerId },
			{
				clickhouse: getClickhouse(),
				database: sqlClient,
				r2: () => {
					const availability = readR2IngestAvailability();
					return availability.enabled
						? createR2MultipartUploadClient(availability.configuration)
						: null;
				},
				signal,
			},
		);
	});

export const savedOutputsRouter = os.analytics.savedOutputs.router({ get });
