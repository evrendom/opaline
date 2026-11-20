/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_FRONTEND_FIXTURES?: string;
	readonly VITE_SESSION_DETAIL_FAST_PATH?: string;
}

declare module "*/graphical/generated/tailwind-merge.cjs" {
	import type { ConfigExtension } from "tailwind-merge";
	const config: ConfigExtension<string, string>;
	export default config;
}
