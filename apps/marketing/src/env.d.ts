/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly PUBLIC_DEMO_APP_URL?: string;
	readonly PUBLIC_POSTHOG_ENABLED?: string;
	readonly PUBLIC_POSTHOG_ENVIRONMENT?: string;
	readonly PUBLIC_POSTHOG_HOST?: string;
	readonly PUBLIC_POSTHOG_KEY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
