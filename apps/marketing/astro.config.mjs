// @ts-check

import react from "@astrojs/react";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	devToolbar: { enabled: false },
	integrations: [react()],
	output: "static",
	redirects: {
		"/": "/home",
		"/instant": "/home",
		"/instantv2": "/home",
	},
	site: "https://opaline.so",
});
