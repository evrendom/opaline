import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AppLoadingScreen } from "@/app/bootstrap/AppLoadingScreen";
import { preloadRoute } from "@/app/route-loaders";
import {
	getSessionDetailId,
	getWorkspaceRelativePath,
	getWorkspaceSlugFromPath,
} from "@/app/routes";
import { DesktopOnlyOverlay } from "@/app/ui/DesktopOnlyOverlay";
import { AuthenticatedApp } from "@/features/auth/AuthenticatedApp";
import {
	getDeviceUserCode,
	getValidRedirect,
	isGetStartedPath,
	isResetPasswordPath,
} from "@/features/auth/auth-route-utils";
import { GuestApp } from "@/features/auth/GuestApp";
import { useOAuthDebugAutoDump } from "@/features/auth/oauth-debug";
import { ResetPasswordApp } from "@/features/auth/ResetPasswordApp";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { GetStartedRouteGate } from "@/features/get-started/GetStartedRouteGate";
import { ProductLoadingScreen } from "@/features/shell/product-loading-screen";
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
		preloadRoute(`${location.pathname}${location.search}`);
	}, [location.pathname, location.search]);
	useEffect(() => {
		const sessionId = getSessionDetailId(location.pathname);
		if (sessionId)
			void import("@/features/sessions/session-detail-prefetch")
				.then((prefetch) => {
					prefetch.prefetchSessionDetail(sessionId);
					return prefetch.loadSessionReaderView();
				})
				.catch(() => {});
	}, [location.pathname]);
	const { data: session, isPending } = authClient.useSession();
	// Better Auth re-fetches the session whenever the tab becomes visible and
	// reports a signed-out session as pending again while it does. Only the
	// first lookup is unknown; replacing the tree on later re-fetches would
	// unmount the sign-in forms and drop what the user typed.
	const [sessionResolved, setSessionResolved] = useState(!isPending);
	if (!isPending && !sessionResolved) setSessionResolved(true);
	const isResolvingSession = isPending && !sessionResolved;
	useOAuthDebugAutoDump(session);
	const deviceUserCode = getDeviceUserCode(location.search);
	const isCliSetupPath = location.pathname === CLI_SETUP_PATH;
	const isLegacyDevicePath = location.pathname === "/device";
	const rootRedirectTarget = getValidRedirect(location.search);
	const showDesktopOnlyOverlay =
		!isCliSetupPath && !deviceUserCode && !isGetStartedPath(location.pathname);

	if (isLegacyDevicePath || (deviceUserCode && !isCliSetupPath)) {
		return (
			<Navigate
				replace
				to={`${CLI_SETUP_PATH}${location.search}${location.hash}`}
			/>
		);
	}

	if (isGetStartedPath(location.pathname)) {
		return (
			<>
				<GetStartedRouteGate />
				{showDesktopOnlyOverlay ? <DesktopOnlyOverlay /> : null}
			</>
		);
	}

	if (isResolvingSession) {
		return (
			<>
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

	if (session) {
		return (
			<>
				<AuthenticatedApp rootRedirectTarget={rootRedirectTarget} />
				{showDesktopOnlyOverlay ? <DesktopOnlyOverlay /> : null}
			</>
		);
	}

	if (isResetPasswordPath(location.pathname)) {
		return (
			<>
				<ResetPasswordApp />
				{showDesktopOnlyOverlay ? <DesktopOnlyOverlay /> : null}
			</>
		);
	}

	return (
		<>
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
