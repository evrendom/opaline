import { adminMiddleware, os } from "../../middleware.js";
import { readConfiguredRunIndexHealStatus } from "../../services/l1-edges/run-index-heal-worker.service.js";

export const runIndexHealAdminRouter = {
	status: os.admin.runIndexHeal.status
		.use(adminMiddleware)
		.handler(() => readConfiguredRunIndexHealStatus()),
};
