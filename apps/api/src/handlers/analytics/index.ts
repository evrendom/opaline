import { os } from "../../middleware.js";
import { developersRouter } from "./developers.js";
import { imagesRouter } from "./images.js";
import { momentsRouter } from "./moments.js";
import { overviewRouter } from "./overview.js";
import { repositoriesRouter } from "./repositories.js";
import { savedOutputsRouter } from "./saved-outputs.js";
import { sessionsRouter } from "./sessions.js";
import { skillsRouter } from "./skills.js";

export const analyticsRouter = os.analytics.router({
	moments: momentsRouter,
	savedOutputs: savedOutputsRouter,
	images: imagesRouter,
	overview: overviewRouter,
	developers: developersRouter,
	sessions: sessionsRouter,
	skills: skillsRouter,
	repositories: repositoriesRouter,
});
