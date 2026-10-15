import { ORPCError } from "@orpc/server";
import { sqlClient } from "../../db.js";
import { orgMiddleware, os } from "../../middleware.js";
import {
	readCompassSettings,
	writeCompassSettings,
} from "../../services/moments/compass-settings.js";
import { momentsEnv } from "../../services/moments/env.js";
import {
	listMoments,
	MomentNotFoundError,
	type MomentsCaller,
	mayObserve,
	ObservationLimitError,
	ObservationsUnavailableError,
	observeMoment,
	readRunDetail,
	voteOnObservation,
} from "../../services/moments/moments.service.js";
import { ObservationRefusedError } from "../../services/moments/observer.js";
import {
	momentPatterns,
	PatternNotFoundError,
	recordMomentFix,
} from "../../services/moments/patterns.js";
import { readableSessionOwner } from "../../services/session-visibility.js";
import { workspaceFeatureEnabled } from "../../services/workspace-features.js";

/**
 * Moments, observations and patterns on the Compass page
 * (`services/moments/`). Every procedure needs the workspace's Moments
 * switch; observing also needs Moment observations and a configured model.
 * Callers read only the runs they may read.
 */
const procedures = os.analytics.moments;

function momentsOpen(workspaceId: string): Promise<boolean> {
	return workspaceFeatureEnabled(sqlClient, "moments", workspaceId);
}

async function caller(context: {
	organizationId: string;
	user: { id: string };
	sessionReader: Parameters<typeof readableSessionOwner>[0];
}): Promise<MomentsCaller> {
	if (!(await momentsOpen(context.organizationId)))
		throw new ORPCError("FORBIDDEN", {
			message: "Moments are not enabled for this workspace.",
		});
	return {
		workspaceId: context.organizationId,
		member: readableSessionOwner(context.sessionReader),
		viewerId: context.user.id,
	};
}

function mapped(error: unknown): never {
	if (
		error instanceof MomentNotFoundError ||
		error instanceof PatternNotFoundError
	)
		throw new ORPCError("NOT_FOUND", { message: error.message });
	if (error instanceof ObservationsUnavailableError)
		throw new ORPCError("FORBIDDEN", { message: error.message });
	if (error instanceof ObservationLimitError)
		throw new ORPCError("TOO_MANY_REQUESTS", { message: error.message });
	if (error instanceof ObservationRefusedError)
		throw new ORPCError("UNPROCESSABLE_CONTENT", { message: error.message });
	throw error;
}

export const momentsRouter = os.analytics.moments.router({
	access: procedures.access.use(orgMiddleware).handler(async ({ context }) => {
		const moments = await momentsOpen(context.organizationId);
		return {
			moments,
			observations:
				moments && (await mayObserve(momentsEnv(), context.organizationId)),
		};
	}),
	list: procedures.list
		.use(orgMiddleware)
		.handler(async ({ input, context }) =>
			listMoments(momentsEnv(), await caller(context), input).catch(mapped),
		),
	run: procedures.run
		.use(orgMiddleware)
		.handler(async ({ input, context }) =>
			readRunDetail(momentsEnv(), await caller(context), input).catch(mapped),
		),
	observe: procedures.observe
		.use(orgMiddleware)
		.handler(async ({ input, context }) =>
			observeMoment(momentsEnv(), await caller(context), input).catch(mapped),
		),
	feedback: procedures.feedback
		.use(orgMiddleware)
		.handler(async ({ input, context }) =>
			voteOnObservation(momentsEnv(), await caller(context), input).catch(
				mapped,
			),
		),
	patterns: procedures.patterns
		.use(orgMiddleware)
		.handler(async ({ input, context }) =>
			momentPatterns(momentsEnv(), await caller(context), input).catch(mapped),
		),
	recordFix: procedures.recordFix
		.use(orgMiddleware)
		.handler(async ({ input, context }) =>
			recordMomentFix(momentsEnv(), await caller(context), input).catch(mapped),
		),
	settings: procedures.settings
		.use(orgMiddleware)
		.handler(async ({ context }) => {
			await caller(context);
			const [settings, frustrationCheck] = await Promise.all([
				readCompassSettings(sqlClient, context.organizationId),
				workspaceFeatureEnabled(
					sqlClient,
					"frustration_check",
					context.organizationId,
				),
			]);
			return { settings, canEdit: context.isOrgAdmin, frustrationCheck };
		}),
	updateSettings: procedures.updateSettings
		.use(orgMiddleware)
		.handler(async ({ input, context }) => {
			await caller(context);
			if (!context.isOrgAdmin)
				throw new ORPCError("FORBIDDEN", {
					message: "Only workspace owners and admins can change Compass.",
				});
			return writeCompassSettings(
				sqlClient,
				context.organizationId,
				input as Parameters<typeof writeCompassSettings>[2],
				context.user.id,
			);
		}),
});
