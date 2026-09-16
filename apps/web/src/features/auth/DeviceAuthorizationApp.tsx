import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { z } from "zod";
import { AppLoadingScreen } from "@/app/bootstrap/AppLoadingScreen";
import { Button } from "@/app/ui/button";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import {
	type AppSession,
	getCliConnectionId,
	getSessionUserId,
} from "@/features/auth/auth-route-utils";
import { GuestApp } from "@/features/auth/GuestApp";
import { cliSetupUrl } from "@/features/cli-onboarding/cli-authorization";

function ApprovedDeviceSetupPage() {
	return <Navigate replace to={"/welcome"} />;
}

function PairedDeviceLogin({
	connectionId,
	userCode,
}: {
	connectionId: string;
	userCode: string;
}) {
	useEffect(() => {
		window.location.replace(
			cliSetupUrl(connectionId, window.location.origin, userCode),
		);
	}, [connectionId, userCode]);
	return <AppLoadingScreen message="Opening your session setup…" />;
}

export function DeviceAuthorizationApp({
	deviceUserCode,
	session,
}: {
	deviceUserCode: string;
	session: AppSession | null;
}) {
	const { trackAuthenticationAction } = useAnalyticsTracking({
		pageName: "device_login",
	});
	const [deviceProcessing, setDeviceProcessing] = useState(false);
	const [deviceApproved, setDeviceApproved] = useState(false);
	const [deviceDenied, setDeviceDenied] = useState(false);
	const [deviceError, setDeviceError] = useState<string | null>(null);

	async function submitDeviceDecision(action: "approve" | "deny") {
		if (deviceProcessing) return;

		trackAuthenticationAction({
			actionName:
				action === "approve" ? "approve_device_login" : "deny_device_login",
			sourceComponent: "device_login",
			authMethod: "device_code",
			targetId: deviceUserCode,
			userId: getSessionUserId(session) ?? undefined,
		});

		setDeviceProcessing(true);
		setDeviceError(null);

		try {
			let connectionReturnUrl: string | undefined;
			const connectionId = getCliConnectionId();
			if (connectionId && action === "approve") {
				const authorization = await fetch(
					`/api/cli/connections/${connectionId}/authorize`,
					{
						method: "POST",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ userCode: deviceUserCode }),
					},
				);
				if (!authorization.ok)
					throw new Error(
						"Open this login link in the same browser where you copied the CLI command.",
					);
				connectionReturnUrl = z
					.object({ returnUrl: z.string().url() })
					.parse(await authorization.json()).returnUrl;
			}
			const response = await fetch(`/api/auth/device/${action}`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userCode: deviceUserCode }),
			});

			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error_description?: string;
					message?: string;
				} | null;

				throw new Error(
					body?.error_description ??
						body?.message ??
						`Failed to ${action} CLI device login`,
				);
			}

			if (action === "approve") {
				if (connectionReturnUrl) {
					window.location.assign(connectionReturnUrl);
					return;
				}
				setDeviceApproved(true);
			} else {
				setDeviceDenied(true);
			}
		} catch (err) {
			setDeviceError(
				err instanceof Error ? err.message : "Failed to process device login",
			);
		} finally {
			setDeviceProcessing(false);
		}
	}

	const connectionId = getCliConnectionId();
	if (connectionId)
		return (
			<PairedDeviceLogin
				connectionId={connectionId}
				userCode={deviceUserCode}
			/>
		);

	if (!session) {
		return <GuestApp />;
	}

	if (deviceProcessing) {
		return <AppLoadingScreen message="Processing CLI login…" />;
	}

	if (deviceApproved) {
		return <ApprovedDeviceSetupPage />;
	}

	if (deviceDenied) {
		return (
			<div className="flex min-h-screen flex-col items-center justify-center gap-2">
				<h1 className="text-xl font-semibold">CLI login denied</h1>
				<p className="text-muted-foreground">
					This authorization request was not approved.
				</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4">
			<h1 className="text-xl font-semibold">Authorize CLI login</h1>
			<p className="text-muted-foreground">
				User code: <span className="font-mono">{deviceUserCode}</span>
			</p>
			{deviceError ? (
				<p className="text-destructive">{deviceError}</p>
			) : (
				<p className="text-muted-foreground">
					Approve this request only if it was initiated by you from the CLI.
				</p>
			)}
			<div className="flex gap-2">
				<Button onClick={() => submitDeviceDecision("approve")}>Approve</Button>
				<Button variant="outline" onClick={() => submitDeviceDecision("deny")}>
					Deny
				</Button>
			</div>
		</div>
	);
}
