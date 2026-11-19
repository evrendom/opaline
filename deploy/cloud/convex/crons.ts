import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
crons.daily(
	"expire analysis query results",
	{ hourUTC: 3, minuteUTC: 0 },
	makeFunctionReference<"mutation", { cursor: null }>(
		"retention:expireQueryResults",
	),
	{ cursor: null },
);
crons.daily(
	"expire unsaved analysis drafts",
	{ hourUTC: 3, minuteUTC: 0 },
	makeFunctionReference<"mutation", Record<string, never>>(
		"retention:expireDraftsDaily",
	),
	{},
);

export default crons;
