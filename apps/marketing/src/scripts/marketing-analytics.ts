const EVENT_VERSION = 1;
const ANALYTICS_SURFACE = "marketing";
const INSTALL_COMMAND_COPIED_EVENT = "opaline:install-command-copied";
const IFRAME_LOAD_TIMEOUT_MS = 15_000;

type PostHogClient = typeof import("posthog-js")["default"];
type MarketingEnvironment = "production" | "staging" | "development" | "local";

let posthogClient: PostHogClient | null = null;
let posthogClientPromise: Promise<PostHogClient | null> | null = null;
const pendingActions: Array<(client: PostHogClient) => void> = [];

function getConfig() {
	const key = (import.meta.env.PUBLIC_POSTHOG_KEY ?? "").trim();
	const host = (import.meta.env.PUBLIC_POSTHOG_HOST ?? "").trim();
	const enabled =
		(import.meta.env.PUBLIC_POSTHOG_ENABLED ?? "false").trim() === "true";

	if (!enabled || key.length === 0 || host.length === 0) {
		return null;
	}

	return { key, host };
}

function getEnvironment(): MarketingEnvironment {
	const configuredEnvironment = (
		import.meta.env.PUBLIC_POSTHOG_ENVIRONMENT ?? ""
	).trim();
	if (
		configuredEnvironment === "production" ||
		configuredEnvironment === "staging" ||
		configuredEnvironment === "development" ||
		configuredEnvironment === "local"
	) {
		return configuredEnvironment;
	}

	if (
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1"
	) {
		return "local";
	}
	if (window.location.hostname.includes("staging")) {
		return "staging";
	}
	return "production";
}

function isDebugModeEnabled() {
	return (
		new URLSearchParams(window.location.search).get("__posthog_debug") ===
		"true"
	);
}

function flushPendingActions(client: PostHogClient) {
	const actions = pendingActions.splice(0);
	for (const action of actions) {
		try {
			action(client);
		} catch {
			// Monitoring must never interrupt the landing-page experience.
		}
	}
}

async function loadPostHogClient(): Promise<PostHogClient | null> {
	if (posthogClient) {
		return posthogClient;
	}

	const config = getConfig();
	if (!config) {
		return null;
	}

	if (!posthogClientPromise) {
		posthogClientPromise = import("posthog-js")
			.then(({ default: client }) => {
				client.init(config.key, {
					api_host: config.host,
					autocapture: false,
					capture_exceptions: true,
					capture_pageleave: "if_capture_pageview",
					capture_pageview: true,
					cookieless_mode: "always",
					debug: isDebugModeEnabled(),
					defaults: "2026-01-30",
					disable_session_recording: true,
					disable_surveys: true,
					person_profiles: "never",
				});
				client.register({
					environment: getEnvironment(),
					event_version: EVENT_VERSION,
					surface: ANALYTICS_SURFACE,
				});
				posthogClient = client;
				flushPendingActions(client);
				return client;
			})
			.catch(() => {
				pendingActions.length = 0;
				posthogClientPromise = null;
				return null;
			});
	}

	return posthogClientPromise;
}

function withPostHogClient(action: (client: PostHogClient) => void) {
	if (!getConfig()) {
		return;
	}

	if (posthogClient) {
		action(posthogClient);
		return;
	}

	pendingActions.push(action);
	void loadPostHogClient();
}

function captureMarketingEvent(
	eventName: string,
	properties: Record<string, unknown> = {},
) {
	withPostHogClient((client) => {
		client.capture(eventName, properties);
	});
}

function getTrackingElement(event: Event) {
	return event.target instanceof Element
		? event.target.closest<HTMLElement>("[data-marketing-install-source]")
		: null;
}

function monitorInstallCopies() {
	document.addEventListener(INSTALL_COMMAND_COPIED_EVENT, (event) => {
		const source =
			getTrackingElement(event)?.dataset.marketingInstallSource ?? "unknown";
		captureMarketingEvent("marketing_install_command_copied", { source });
	});
}

function monitorGitHubClicks() {
	document.addEventListener("click", (event) => {
		const link =
			event.target instanceof Element
				? event.target.closest<HTMLAnchorElement>("[data-instant-v2-github]")
				: null;
		if (!link) {
			return;
		}

		captureMarketingEvent("marketing_github_clicked", {
			repository: link.dataset.githubRepo ?? "unknown",
		});
	});
}

function monitorPricingActions() {
	document.addEventListener("click", (event) => {
		const link =
			event.target instanceof Element
				? event.target.closest<HTMLAnchorElement>(
						"[data-marketing-pricing-action]",
					)
				: null;
		if (!link) {
			return;
		}

		const card = link.closest<HTMLElement>(".pricing-card");
		const billingToggle = card?.querySelector<HTMLButtonElement>(
			"[data-pricing-toggle]",
		);
		const billingPeriod = billingToggle
			? billingToggle.getAttribute("aria-pressed") === "true"
				? "yearly"
				: "monthly"
			: link.dataset.marketingPricingPlan === "free"
				? "free"
				: "custom";

		captureMarketingEvent("marketing_pricing_action_clicked", {
			action: link.dataset.marketingPricingAction ?? "unknown",
			billing_period: billingPeriod,
			plan: link.dataset.marketingPricingPlan ?? "unknown",
		});
	});
}

function monitorProductIframe() {
	const iframe = document.querySelector<HTMLIFrameElement>(
		"[data-instant-v2-product-iframe]",
	);
	if (!iframe) {
		return;
	}

	let failureCaptured = false;
	let loadCompleted = false;
	const sourceUrl = new URL(iframe.src, window.location.href);
	const sourceProperties = {
		iframe_host: sourceUrl.host,
		iframe_path: sourceUrl.pathname,
	};
	const captureFailure = (reason: string) => {
		if (failureCaptured || loadCompleted) {
			return;
		}
		failureCaptured = true;
		captureMarketingEvent("marketing_product_iframe_failed", {
			...sourceProperties,
			reason,
		});
	};

	if (window.location.protocol === "https:" && sourceUrl.protocol === "http:") {
		captureFailure("insecure_source");
		return;
	}

	const loadTimeout = window.setTimeout(
		() => captureFailure("load_timeout"),
		IFRAME_LOAD_TIMEOUT_MS,
	);
	iframe.addEventListener(
		"load",
		() => {
			loadCompleted = true;
			window.clearTimeout(loadTimeout);
		},
		{ once: true },
	);
	iframe.addEventListener(
		"error",
		() => {
			window.clearTimeout(loadTimeout);
			captureFailure("error_event");
		},
		{ once: true },
	);
}

function initMarketingMonitoring() {
	monitorInstallCopies();
	monitorGitHubClicks();
	monitorPricingActions();
	monitorProductIframe();
	void loadPostHogClient();
}

initMarketingMonitoring();
