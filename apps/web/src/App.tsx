import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { AppLoadingScreen } from "@/app/bootstrap/AppLoadingScreen";
import {
	getWorkspaceRelativePath,
	getWorkspaceSlugFromPath,
} from "@/app/routes";
import { loadSessionsPage } from "@/app/session-page-loader";
import { NotFoundPage } from "@/app/system/NotFoundPage";
import { DesktopOnlyOverlay } from "@/app/ui/DesktopOnlyOverlay";
import { ProductAnalyticsSessionSync } from "@/features/analytics/tracking/ProductAnalyticsSessionSync";
import { AuthenticatedApp } from "@/features/auth/AuthenticatedApp";
import {
	getDeviceUserCode,
	getPendingSignupRedirect,
	getValidRedirect,
	isGetStartedPath,
	isResetPasswordPath,
} from "@/features/auth/auth-route-utils";
import { DeviceAuthorizationApp } from "@/features/auth/DeviceAuthorizationApp";
import { GuestApp } from "@/features/auth/GuestApp";
import { useOAuthDebugAutoDump } from "@/features/auth/oauth-debug";
import { ResetPasswordApp } from "@/features/auth/ResetPasswordApp";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { GetStartedRouteGate } from "@/features/get-started/GetStartedRouteGate";
import { ProductLoadingScreen } from "@/features/shell/product-loading-screen";
import { SupportEmailButton } from "@/features/support/SupportEmailButton";
import { authClient } from "./lib/auth-client";

const ConversationTraceFixturePage = import.meta.env.DEV
	? lazy(() =>
			import("@/components/conversation/ConversationTraceFixturePage").then(
				(module) => ({ default: module.ConversationTraceFixturePage }),
			),
		)
	: null;

const SessionContinuousTraceFixturePage = import.meta.env.DEV
	? lazy(() =>
			import(
				"@/features/sessions/components/SessionContinuousTraceFixturePage"
			).then((module) => ({
				default: module.SessionContinuousTraceFixturePage,
			})),
		)
	: null;

const SessionDetailFastIntegrationPage = import.meta.env.DEV
	? lazy(() =>
			import(
				"@/features/sessions/components/SessionDetailFastIntegrationPage"
			).then((module) => ({
				default: module.SessionDetailFastIntegrationPage,
			})),
		)
	: null;

const TranscriptMaskFixturePage = import.meta.env.DEV
	? lazy(() =>
			import(
				"@/features/sessions/components/transcript-mask-fixture-page"
			).then((module) => ({
				default: module.TranscriptMaskFixturePage,
			})),
		)
	: null;

function FullscreenRouteLoadingScreen() {
	return <AppLoadingScreen />;
}

function SessionAwareApp() {
	const location = useLocation();
	useEffect(() => {
		const path = location.pathname;
		if (
			path === "/" ||
			path === "/session" ||
			/\/sessions(?:\/|$)/.test(path)
		) {
			void loadSessionsPage().catch(() => {
				/* Navigation retries a failed preload. */
			});
		}
	}, [location.pathname]);
	const { data: session, isPending } = authClient.useSession();
	useOAuthDebugAutoDump(session);
	const deviceUserCode = getDeviceUserCode(location.search);
	const isCliSetupPath = location.pathname === CLI_SETUP_PATH;
	const rootRedirectTarget =
		getValidRedirect(location.search) ??
		(location.pathname === "/"
			? getPendingSignupRedirect(location.search)
			: null);
	const showDesktopOnlyOverlay =
		!isCliSetupPath && !deviceUserCode && !isGetStartedPath(location.pathname);

	if (/^\/(?:wrapped|dev\/wrapped|resume)(?:\/|$)/u.test(location.pathname)) {
		return <NotFoundPage />;
	}

	if (deviceUserCode && !isCliSetupPath) {
		return (
			<>
				<ProductAnalyticsSessionSync session={session} />
				<DeviceAuthorizationApp
					key={deviceUserCode}
					deviceUserCode={deviceUserCode}
					session={session ?? null}
				/>
			</>
		);
	}

	if (isGetStartedPath(location.pathname)) {
		return (
			<>
				<ProductAnalyticsSessionSync session={session} />
				<GetStartedRouteGate />
				{showDesktopOnlyOverlay ? <DesktopOnlyOverlay /> : null}
			</>
		);
	}

	if (isPending && !isCliSetupPath) {
		return (
			<>
				<ProductAnalyticsSessionSync session={session} />
				{getWorkspaceSlugFromPath(location.pathname) ||
				getWorkspaceRelativePath(location.pathname) !== null ? (
					<ProductLoadingScreen />
				) : (
					<AppLoadingScreen />
				)}
				{showDesktopOnlyOverlay ? <DesktopOnlyOverlay /> : null}
			</>
		);
	}

	if (session || isCliSetupPath) {
		return (
			<>
				<ProductAnalyticsSessionSync session={session} />
				<AuthenticatedApp rootRedirectTarget={rootRedirectTarget} />
				{session ? <SupportEmailButton /> : null}
				{showDesktopOnlyOverlay ? <DesktopOnlyOverlay /> : null}
			</>
		);
	}

	if (isResetPasswordPath(location.pathname)) {
		return (
			<>
				<ProductAnalyticsSessionSync session={session} />
				<ResetPasswordApp />
				{showDesktopOnlyOverlay ? <DesktopOnlyOverlay /> : null}
			</>
		);
	}

	return (
		<>
			<ProductAnalyticsSessionSync session={session} />
			<GuestApp />
			{showDesktopOnlyOverlay ? <DesktopOnlyOverlay /> : null}
		</>
	);
}

function App() {
	const location = useLocation();
	const isTraceTreeFixturePath =
		location.pathname === "/dev/trace-tree-fixture";
	const traceTreeFixtureMode = new URLSearchParams(location.search).get("mode");
	const TraceTreeFixturePage =
		traceTreeFixtureMode === "continuous"
			? SessionContinuousTraceFixturePage
			: ConversationTraceFixturePage;
	const isSessionDetailFastIntegrationPath =
		location.pathname === "/dev/session-detail-fast-integration" ||
		location.pathname === "/dev/session-detail-fast-integration/v2";
	const isTranscriptMaskFixturePath =
		location.pathname === "/dev/transcript-mask";

	if (isTranscriptMaskFixturePath && TranscriptMaskFixturePage) {
		return (
			<Suspense fallback={<FullscreenRouteLoadingScreen />}>
				<TranscriptMaskFixturePage />
			</Suspense>
		);
	}

	if (isSessionDetailFastIntegrationPath && SessionDetailFastIntegrationPage) {
		return (
			<Suspense fallback={<FullscreenRouteLoadingScreen />}>
				<SessionDetailFastIntegrationPage />
			</Suspense>
		);
	}

	if (isTraceTreeFixturePath && TraceTreeFixturePage) {
		return (
			<Suspense fallback={<FullscreenRouteLoadingScreen />}>
				<TraceTreeFixturePage />
			</Suspense>
		);
	}

	return <SessionAwareApp />;
}

export default App;
