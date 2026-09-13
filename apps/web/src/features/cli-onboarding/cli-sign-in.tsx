import { type FormEvent, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import type { CliConnectionSnapshot } from "../../../../../packages/api-routes/src/cli-connection";
import type { CliAuthorization } from "./cli-authorization";
import {
	type CliSession,
	readCliSession,
	sendCliEmailCode,
	signInCliWithEmail,
	signInCliWithProvider,
	signOutCliSession,
} from "./cli-onboarding-auth";
import "./cli-onboarding.css";

import { WelcomeBack, WelcomeProgress } from "./welcome-panel";
import { WelcomeSteps } from "./welcome-steps";

export function CliSignIn({
	authorization,
	snapshot,
	onFinish,
}: {
	authorization: CliAuthorization;
	snapshot: CliConnectionSnapshot;
	onFinish: () => void;
}) {
	const { refetch } = authClient.useSession();
	const [session, setSession] = useState<CliSession>(null);
	const [checking, setChecking] = useState(true);
	const [busy, setBusy] = useState(false);

	const [error, setError] = useState<string | null>(null);
	const [email, setEmail] = useState("");
	const [otp, setOtp] = useState("");
	const [emailStage, setEmailStage] = useState<"choice" | "email" | "code">(
		"choice",
	);
	const localPreview =
		["localhost", "127.0.0.1"].includes(window.location.hostname) &&
		document.querySelector('meta[name="opaline-local-cli"]') !== null;
	useEffect(() => {
		const abort = new AbortController();
		const refresh = () =>
			void readCliSession(abort.signal)
				.then(setSession)
				.catch((error: unknown) => {
					if (!abort.signal.aborted)
						setError(
							error instanceof Error
								? error.message
								: "Could not check sign-in.",
						);
				})
				.finally(() => {
					if (!abort.signal.aborted) setChecking(false);
				});
		refresh();
		window.addEventListener("focus", refresh);
		const sync = (event: StorageEvent) => {
			if (event.key?.startsWith(`opaline.welcome.${authorization.id}.`))
				refresh();
		};
		window.addEventListener("storage", sync);
		return () => {
			abort.abort();
			window.removeEventListener("focus", refresh);
			window.removeEventListener("storage", sync);
		};
	}, [authorization.id]);

	async function run(action: () => Promise<unknown>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await action();
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Could not complete sign-in. Please try again.",
			);
		} finally {
			setBusy(false);
		}
	}
	async function submitEmail(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		await run(async () => {
			if (emailStage === "email") {
				await sendCliEmailCode(email.trim());
				setEmailStage("code");
			} else {
				const signedIn = await signInCliWithEmail(email.trim(), otp);
				if (!signedIn)
					throw new Error("Sign-in did not complete. Please try again.");
				setSession(signedIn);
				await refetch();
			}
		});
	}
	if (checking)
		return (
			<>
				<WelcomeProgress step={1} />
				<output>Checking your sign-in…</output>
			</>
		);
	if (session)
		return (
			<WelcomeSteps
				key={session.user.id}
				session={session}
				authorization={authorization}
				snapshot={snapshot}
				onFinish={onFinish}
				onSignOut={async () => {
					await signOutCliSession();
					setSession(null);
					await refetch();
				}}
			/>
		);
	return (
		<div data-cli-sign-in>
			<WelcomeProgress step={1} />
			{emailStage !== "choice" && (
				<WelcomeBack
					disabled={busy}
					onClick={() => {
						setEmailStage(emailStage === "code" ? "email" : "choice");
						setError(null);
						setOtp("");
					}}
				/>
			)}
			<h2>Make this dashboard yours</h2>
			<p>Sign in to bring your selected sessions into your own workspace.</p>
			{error ? (
				<p className="cli-onboarding-error" role="alert">
					{error}
				</p>
			) : null}
			{emailStage === "choice" ? (
				<>
					<div className="cli-onboarding-auth-options">
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								void run(() => signInCliWithProvider("google", authorization))
							}
						>
							Continue with Google
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								void run(() => signInCliWithProvider("github", authorization))
							}
						>
							Continue with GitHub
						</button>
						<span className="cli-onboarding-divider">or</span>
						<button
							type="button"
							disabled={busy}
							onClick={() => setEmailStage("email")}
						>
							Continue with Email
						</button>
					</div>
					<p className="cli-onboarding-terms">
						By continuing, you agree to our{" "}
						<a href="/legal/terms-of-service" target="_blank" rel="noreferrer">
							Terms of Service
						</a>{" "}
						and{" "}
						<a href="/legal/privacy-policy" target="_blank" rel="noreferrer">
							Privacy Policy
						</a>
						.
					</p>
					{localPreview ? (
						<button
							className="cli-onboarding-text-button"
							type="button"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const response = await fetch(
										"/__preview/onboarding-sign-in",
										{ method: "POST" },
									);
									if (!response.ok)
										throw new Error("Local sign-in failed. Please try again.");
									setSession(await readCliSession());
									await refetch();
								})
							}
						>
							Continue with local test account
						</button>
					) : null}
				</>
			) : (
				<form
					className="cli-onboarding-email"
					onSubmit={(event) => void submitEmail(event)}
				>
					{emailStage === "email" ? (
						<>
							<label htmlFor="cli-email">Email address</label>
							<input
								autoComplete="email"
								id="cli-email"
								name="email"
								type="email"
								value={email}
								required
								disabled={busy}
								onChange={(event) => setEmail(event.target.value)}
							/>
							<button
								className="cli-onboarding-primary"
								disabled={busy}
								type="submit"
							>
								{busy ? "Sending…" : "Send sign-in code"}
							</button>
						</>
					) : (
						<>
							<p>Enter the 6-digit code sent to {email}.</p>
							<label htmlFor="cli-email-code">Sign-in code</label>
							<input
								id="cli-email-code"
								name="code"
								autoComplete="one-time-code"
								inputMode="numeric"
								pattern="[0-9]{6}"
								maxLength={6}
								value={otp}
								required
								disabled={busy}
								onChange={(event) =>
									setOtp(event.target.value.replace(/\D/gu, "").slice(0, 6))
								}
							/>
							<button
								className="cli-onboarding-primary"
								disabled={busy}
								type="submit"
							>
								{busy ? "Signing in…" : "Sign in"}
							</button>
							<button
								className="cli-onboarding-text-button"
								type="button"
								disabled={busy}
								onClick={() => void run(() => sendCliEmailCode(email.trim()))}
							>
								Resend code
							</button>
						</>
					)}
				</form>
			)}
		</div>
	);
}
