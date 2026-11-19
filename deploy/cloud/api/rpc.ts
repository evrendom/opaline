import { handleVercelRpcRequest as handler } from "../../../apps/api/src/vercel-rpc-handler.js";

export {
	handler as DELETE,
	handler as GET,
	handler as HEAD,
	handler as OPTIONS,
	handler as PATCH,
	handler as POST,
	handler as PUT,
};
