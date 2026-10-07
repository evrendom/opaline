import { sqlClient } from "../../db.js";
import {
	isGitHubEvidenceUiEnabled,
	readGitHubEvidenceUiForceOrgIds,
} from "../../lib/env.js";
import { orgMiddleware, os } from "../../middleware.js";
import { getCostDashboard } from "../../services/cost-dashboard.service.js";
import {
	readGitHubOutcomesReadiness,
	resolveGitHubOutcomesVisibility,
} from "../../services/github-outcomes-readiness.service.js";
import {
	getOverviewKPIs,
	getUsersDailyTrend,
} from "../../services/overview.service.js";

const kpis = os.analytics.overview.kpis
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		return getOverviewKPIs(
			context.organizationId,
			input.startDate,
			input.endDate,
		);
	});

const usersDailyTrend = os.analytics.overview.usersDailyTrend
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		return getUsersDailyTrend(
			context.organizationId,
			input.startDate,
			input.endDate,
		);
	});

const costs = os.analytics.overview.costs
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		// Forced workspaces see the GitHub metrics (as a preview until their
		// history is complete) even while the deployment keeps them dark.
		const forced = readGitHubEvidenceUiForceOrgIds().includes(
			context.organizationId,
		);
		const uiEnabled = isGitHubEvidenceUiEnabled() || forced;
		const readiness = uiEnabled
			? await readGitHubOutcomesReadiness(sqlClient, context.organizationId)
			: null;
		return getCostDashboard(
			{ tenant: "organization", orgId: context.organizationId },
			input,
			{
				githubEvidenceUiEnabled: uiEnabled,
				githubReadiness: readiness,
				githubVisibility: resolveGitHubOutcomesVisibility({
					uiEnabled,
					forced,
					readiness,
				}),
			},
		);
	});

export const overviewRouter = os.analytics.overview.router({
	costs,
	kpis,
	usersDailyTrend,
});
