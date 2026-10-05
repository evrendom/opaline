// @ts-check

import react from "@astrojs/react";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	devToolbar: { enabled: false },
	integrations: [
		react(),
		// Design playgrounds, served by `astro dev` and never built.
		{
			name: "opaline-dev-playgrounds",
			hooks: {
				"astro:config:setup": ({ command, injectRoute }) => {
					if (command !== "dev") return;
					injectRoute({
						pattern: "/dev/trends-cards",
						entrypoint: new URL(
							"./src/dev/trends-cards.astro",
							import.meta.url,
						),
					});
				},
			},
		},
	],
	output: "static",
	redirects: {
		"/instant": "/",
		"/instantv2": "/",
	},
	site: "https://opaline.so",
});
