import { shouldUsePersistentSkillAnalytics } from "../../lib/env.js";
import { orgMiddleware, os } from "../../middleware.js";
import { listHistoricalSkills } from "../../services/historical-skills.service.js";
import { listLegacyHistoricalCodexSkills } from "../../services/legacy-historical-skills.service.js";
import {
	listRepositories,
	listRepositoryNavigation,
} from "../../services/repositories.service.js";
import { repositoryFileActivity } from "../../services/repository-file-activity.service.js";
import {
	listRepositoryFiles,
	readRepositoryFile,
} from "../../services/repository-files.service.js";
import { getRepositoryOverview } from "../../services/repository-overview.service.js";
import { repositoryPullRequests } from "../../services/repository-pull-requests.service.js";
import {
	reportCalls,
	reportRuns,
} from "../../services/repository-report-evidence.service.js";
import { repositoryRunCalls } from "../../services/repository-run-calls.service.js";
import { repositoryRuns } from "../../services/repository-runs.service.js";
import { repositorySessionBoxes } from "../../services/repository-session-boxes.service.js";
import {
	repositoryMcpTools,
	repositorySetup,
	repositorySetupSessions,
	repositorySetupText,
} from "../../services/repository-setup.service.js";
import { sessionRunCiEnv } from "../../services/run-ci/env.js";
import { readableSessionOwner } from "../../services/session-visibility.js";

const list = os.analytics.repositories.list
	.use(orgMiddleware)
	.handler(({ context }) => listRepositories(context.organizationId));
const navigation = os.analytics.repositories.navigation
	.use(orgMiddleware)
	.handler(({ context }) => listRepositoryNavigation(context.organizationId));
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
const pullRequests = os.analytics.repositories.pullRequests
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		repositoryPullRequests(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input.repoKey,
		),
	);
const setup = os.analytics.repositories.setup
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		repositorySetup(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input.repoKey,
			input.range,
		),
	);
const setupText = os.analytics.repositories.setupText
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		repositorySetupText(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input.repoKey,
			input.setupFile,
			input.range,
		),
	);
const setupSessions = os.analytics.repositories.setupSessions
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		repositorySetupSessions(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input.repoKey,
			input.setupFile,
			input.range,
		),
	);
const mcpTools = os.analytics.repositories.mcpTools
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		repositoryMcpTools(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input.repoKey,
			input.range,
		),
	);
const files = os.analytics.repositories.files
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		listRepositoryFiles({
			organizationId: context.organizationId,
			repoKey: input.repoKey,
		}),
	);
const file = os.analytics.repositories.file
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		readRepositoryFile({ organizationId: context.organizationId, ...input }),
	);
const fileActivity = os.analytics.repositories.fileActivity
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		repositoryFileActivity(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input.repoKey,
			input.range,
		),
	);
const runs = os.analytics.repositories.runs
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		repositoryRuns(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input.repoKey,
			input.of,
			input.range,
		),
	);
const runCalls = os.analytics.repositories.runCalls
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		repositoryRunCalls(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input,
		),
	);
const reportRunsHandler = os.analytics.repositories.reportRuns
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		reportRuns(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input,
		),
	);
const reportCallsHandler = os.analytics.repositories.reportCalls
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		reportCalls(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input,
		),
	);
const sessionBoxes = os.analytics.repositories.sessionBoxes
	.use(orgMiddleware)
	.handler(({ input, context }) =>
		repositorySessionBoxes(
			sessionRunCiEnv(),
			{
				workspaceId: context.organizationId,
				member: readableSessionOwner(context.sessionReader),
			},
			input.repoKey,
			input.range,
		),
	);
export const repositoriesRouter = os.analytics.repositories.router({
	list,
	navigation,
	detail,
	overview,
	pullRequests,
	setup,
	setupText,
	setupSessions,
	mcpTools,
	files,
	file,
	fileActivity,
	runs,
	runCalls,
	sessionBoxes,
	reportRuns: reportRunsHandler,
	reportCalls: reportCallsHandler,
});
