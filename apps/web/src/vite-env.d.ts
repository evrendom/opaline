/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL?: string;
	readonly VITE_FRONTEND_FIXTURES?: string;
	readonly VITE_SENTRY_DSN?: string;
}

declare const __APP_VERSION__: string;
