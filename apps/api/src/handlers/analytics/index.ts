import { os } from "../../middleware.js";
import { developersRouter } from "./developers.js";
import { errorsRouter } from "./errors.js";
import { learningsRouter } from "./learnings.js";
import { overviewRouter } from "./overview.js";
import { projectsRouter } from "./projects.js";
import { repositoriesRouter } from "./repositories.js";
import { roiRouter } from "./roi.js";
import { sessionsRouter } from "./sessions.js";
import { skillsRouter } from "./skills.js";

export const analyticsRouter = os.analytics.router({
	overview: overviewRouter,
	developers: developersRouter,
	projects: projectsRouter,
	sessions: sessionsRouter,
	skills: skillsRouter,
	repositories: repositoriesRouter,
	roi: roiRouter,
	errors: errorsRouter,
	learnings: learningsRouter,
});
