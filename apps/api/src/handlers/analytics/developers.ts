import { orgMiddleware, os } from "../../middleware.js";
import {
	getDeveloperList,
	getDeveloperTeamCards,
} from "../../services/developer.service.js";

const list = os.analytics.developers.list
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		return getDeveloperList(context.organizationId, input.days);
	});

const teamCards = os.analytics.developers.teamCards
	.use(orgMiddleware)
	.handler(async ({ input, context }) => {
		return getDeveloperTeamCards(context.organizationId, input.days);
	});

export const developersRouter = os.analytics.developers.router({
	list,
	teamCards,
});
