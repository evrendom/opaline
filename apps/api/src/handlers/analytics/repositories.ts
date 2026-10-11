import { shouldUsePersistentSkillAnalytics } from "../../lib/env.js";
import { orgMiddleware, os } from "../../middleware.js";
import { listHistoricalSkills } from "../../services/historical-skills.service.js";
import { listLegacyHistoricalCodexSkills } from "../../services/legacy-historical-skills.service.js";
import { listRepositories } from "../../services/repositories.service.js";
import { getRepositoryOverview } from "../../services/repository-overview.service.js";

const list = os.analytics.repositories.list
	.use(orgMiddleware)
	.handler(({ context }) => listRepositories(context.organizationId));
const detail = os.analytics.repositories.detail
	.use(orgMiddleware)
	.handler(async ({ input, context }) => ({
		skills: await (shouldUsePersistentSkillAnalytics(context.organizationId)
			? listHistoricalSkills(context.organizationId, input.repoKey)
			: listLegacyHistoricalCodexSkills(context.organizationId, input.repoKey)),
	}));
const overview = os.analytics.repositories.overview
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		getRepositoryOverview(context.organizationId, input),
	);
export const repositoriesRouter = os.analytics.repositories.router({
	list,
	detail,
	overview,
});
