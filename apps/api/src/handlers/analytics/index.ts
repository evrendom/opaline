import { os } from "../../middleware.js";
import { developersRouter } from "./developers.js";
import { momentsRouter } from "./moments.js";
import { overviewRouter } from "./overview.js";
import { repositoriesRouter } from "./repositories.js";
import { sessionsRouter } from "./sessions.js";
import { skillsRouter } from "./skills.js";

export const analyticsRouter = os.analytics.router({
	moments: momentsRouter,
	overview: overviewRouter,
	developers: developersRouter,
	sessions: sessionsRouter,
	skills: skillsRouter,
	repositories: repositoriesRouter,
});
