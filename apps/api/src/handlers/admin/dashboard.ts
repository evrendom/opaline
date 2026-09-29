import { adminMiddleware, os } from "../../middleware.js";
import { getCostDashboard } from "../../services/cost-dashboard.service.js";

export const dashboard = os.admin.dashboard
	.use(adminMiddleware)
	.handler(({ input }) =>
		getCostDashboard(
			{ tenant: "allOrganizations" },
			{ ...input, members: [], repositories: [] },
		),
	);
