import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { contract } from "@rudel/api-routes";
import { callTool, getPluginWorkspace } from "@/widget/host-bridge";
import { createPluginLink } from "@/widget/plugin-transport";
import {
	createRpcBatchLinkPlugin,
	workspaceRequestHeaders,
} from "./rpc-request";

const isProductDemo = import.meta.env.MODE === "product-demo";

const link =
	import.meta.env.MODE === "plugin"
		? createPluginLink(callTool, getPluginWorkspace)
		: new RPCLink({
				// Rendering an HTML preview does not execute requests. Resolve the browser
				// origin only when a real request runs, rather than at module evaluation.
				url: () =>
					new URL(
						isProductDemo ? "/api/demo/rpc" : "/rpc",
						window.location.origin,
					).href,
				headers: () =>
					isProductDemo
						? {}
						: workspaceRequestHeaders(window.location.pathname),
				fetch: (input, init) =>
					fetch(input, { ...init, credentials: "include" }),
				plugins: isProductDemo ? [] : [createRpcBatchLinkPlugin()],
			});

export const client: ContractRouterClient<typeof contract> =
	createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
