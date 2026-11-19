// Onboarding dev mode: work on /welcome in every state without an account,
// API or terminal.
//
//   bun run --cwd apps/desktop/ui dev:onboarding   → http://localhost:4011/dev/onboarding
//
// The page runs as usual; its API calls get fixture answers for the state
// picked in the floating panel (tools/onboarding-dev.ts), which also switches
// the theme and the backdrop.

import type { ConfigEnv, Plugin, UserConfig } from "vite";
import {
	handleOnboardingRequest,
	ONBOARDING_DEV_PATH,
	onboardingPickerScript,
} from "./tools/onboarding-dev";
import baseConfig from "./vite.config";

const onboardingDev: Plugin = {
	name: "onboarding-dev",
	configureServer(server) {
		// Registered before Vite's proxy, so no request reaches a real API.
		server.middlewares.use((request, response, next) => {
			if (!handleOnboardingRequest(request, response)) next();
		});
		// Print the onboarding entry right below Vite's own URLs.
		const printUrls = server.printUrls;
		server.printUrls = () => {
			printUrls();
			const local = server.resolvedUrls?.local[0];
			if (local)
				server.config.logger.info(
					`  ➜  Onboarding dev: ${new URL(ONBOARDING_DEV_PATH, local)}`,
				);
		};
	},
	transformIndexHtml: () => [
		{
			tag: "script",
			children: onboardingPickerScript(),
			injectTo: "body",
		},
	],
};

export default async (env: ConfigEnv): Promise<UserConfig> => {
	const config =
		typeof baseConfig === "function" ? await baseConfig(env) : await baseConfig;
	return {
		...config,
		plugins: [...(config.plugins ?? []), onboardingDev],
	};
};
