import { type FormEvent, useState } from "react";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import { Label } from "@/app/ui/label";
import { Separator } from "@/app/ui/separator";
import { navigateToDestination } from "@/features/auth/auth-navigation";
import {
	getEmailLoginSuccessDestination,
	getEmailSignupSuccessDestination,
	getSocialLoginRedirectOptions,
	getSocialSignupRedirectOptions,
} from "@/features/auth/auth-route-utils";
import {
	isValidAuthEmail,
	isValidEmailCode,
	normalizeAuthEmail,
	sanitizeEmailCodeInput,
} from "@/features/auth/email-code-auth";
import { isLocalDesktopApp } from "@/features/desktop/local-app";
import { authClient, refreshAuthClientState } from "@/lib/auth-client";
import { getInitialSignupName } from "@/lib/auth-signup-name";
import { cn } from "@/lib/utils";
import type { SelfHostInfo } from "./self-host-info";
import {
	forgetInvite,
	inviteFromLocation,
	MAX_PASSWORD_LENGTH,
	readLoginLinkError,
	rememberInvite,
	runAuthRequest,
	type SelfHostedAuthMode,
	type SocialProvider,
	selfHostedSignUp,
	selfHostedSocialProviders,
	validateCredentials,
} from "./self-hosted-auth";

const PROVIDER_LABELS: Record<SocialProvider, string> = {
	github: "GitHub",
	google: "Google",
};

type Feedback = { kind: "error" | "status"; message: string } | null;

export function SelfHostedAuthForm({
	mode,
	info,
	onSwitchMode,
}: {
	mode: SelfHostedAuthMode;
	info: SelfHostInfo;
	onSwitchMode: () => void;
}) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [feedback, setFeedback] = useState<Feedback>(() => {
		const message =
			mode === "sign-in" ? readLoginLinkError(window.location.search) : null;
		return message ? { kind: "error", message } : null;
	});
	const providers = selfHostedSocialProviders(info);
	const emailCodes = info.auth.emailCodes && mode === "sign-in";
	const invite = inviteFromLocation(
		window.location.pathname,
		window.location.search,
	);
	const signUp = selfHostedSignUp(info, invite);

	async function attempt(
		request: () => Promise<{ error: unknown }>,
		destination: string,
	) {
		rememberInvite(invite);
		setLoading(true);
		const problem = await runAuthRequest(request, mode);
		setLoading(false);
		if (problem) {
			setFeedback({ kind: "error", message: problem });
			return;
		}
		forgetInvite();
		refreshAuthClientState();
		navigateToDestination(destination);
	}

	async function submitPassword(event: FormEvent) {
		event.preventDefault();
		const problem = validateCredentials({ mode, email, password });
		if (problem) {
			setFeedback({ kind: "error", message: problem });
			return;
		}
		setFeedback(null);
		const normalizedEmail = normalizeAuthEmail(email);
		await attempt(
			() =>
				mode === "sign-in"
					? authClient.signIn.email({ email: normalizedEmail, password })
					: authClient.signUp.email({
							email: normalizedEmail,
							password,
							name: name.trim() || getInitialSignupName(normalizedEmail),
						}),
			mode === "sign-in"
				? getEmailLoginSuccessDestination()
				: getEmailSignupSuccessDestination(),
		);
	}

	async function sendCode() {
		if (!isValidAuthEmail(email)) {
			setFeedback({ kind: "error", message: "Enter a valid email address." });
			return;
		}
		const normalizedEmail = normalizeAuthEmail(email);
		setFeedback(null);
		setLoading(true);
		const problem = await runAuthRequest(
			() =>
				authClient.emailOtp.sendVerificationOtp({
					email: normalizedEmail,
					type: "sign-in",
				}),
			mode,
		);
		setLoading(false);
		if (problem) {
			setFeedback({ kind: "error", message: problem });
			return;
		}
		setCode("");
		setCodeSentTo(normalizedEmail);
		setFeedback({
			kind: "status",
			message: `Code sent to ${normalizedEmail}.`,
		});
	}

	async function submitCode(event: FormEvent) {
		event.preventDefault();
		if (!codeSentTo) return;
		if (!isValidEmailCode(code)) {
			setFeedback({
				kind: "error",
				message: "Enter the 6-digit code from your email.",
			});
			return;
		}
		setFeedback(null);
		await attempt(
			() => authClient.signIn.emailOtp({ email: codeSentTo, otp: code }),
			getEmailLoginSuccessDestination(),
		);
	}

	async function signInWithProvider(provider: SocialProvider) {
		setFeedback(null);
		const { callbackURL, newUserCallbackURL } =
			mode === "sign-in"
				? getSocialLoginRedirectOptions()
				: getSocialSignupRedirectOptions();
		rememberInvite(invite);
		const problem = await runAuthRequest(
			() =>
				authClient.signIn.social({ provider, callbackURL, newUserCallbackURL }),
			mode,
		);
		if (problem) setFeedback({ kind: "error", message: problem });
	}

	const switchMode = () => {
		setFeedback(null);
		setCodeSentTo(null);
		onSwitchMode();
	};

	if (
		mode === "sign-up" &&
		(signUp === "needs-invite" || signUp === "needs-setup")
	)
		return (
			<div
				className="flex w-full max-w-sm flex-col gap-xl"
				data-self-hosted-auth="invite-only"
			>
				<div
					// design-escape-ok(opacity): no role renders this; field/35 fill, line/60 ring
					className="corner-xl bg-field/35 px-l py-m text-body-xl text-ink-3 ring-1 ring-line/60"
				>
					{signUp === "needs-setup"
						? "No account exists yet. The owner account comes from the server's setup, not from this page."
						: "Ask a workspace owner or admin for an invite link (Settings, Members, Invite link) and open it here to create your account."}
				</div>
				<p className="text-center text-body-xl text-ink-3">
					Already have an account?{" "}
					<button
						type="button"
						onClick={switchMode}
						className="underline underline-offset-4 hover:text-primary"
					>
						Sign in
					</button>
				</p>
			</div>
		);

	return (
		<div
			className="flex w-full max-w-sm flex-col gap-xl"
			data-self-hosted-auth={mode}
		>
			{providers.length > 0 ? (
				<>
					<div className="flex flex-col gap-m">
						{providers.map((provider, index) => (
							<Button
								key={provider}
								type="button"
								variant={index === 0 ? "default" : "outline"}
								className={cn(
									"form-button",
									index === 0 && "opaline-website-primary-button",
								)}
								disabled={loading}
								onClick={() => void signInWithProvider(provider)}
							>
								<span>
									{mode === "sign-in" ? "Log in" : "Create account"} with{" "}
									{PROVIDER_LABELS[provider]}
								</span>
							</Button>
						))}
					</div>
					<div className="flex items-center gap-m">
						<Separator className="flex-1" />
						<span className="text-body-m text-ink-3">OR</span>
						<Separator className="flex-1" />
					</div>
				</>
			) : null}

			{feedback ? (
				<div
					role={feedback.kind === "error" ? "alert" : "status"}
					aria-live="polite"
					className={cn(
						"corner-xl px-l py-m text-body-xl ring-1",
						feedback.kind === "error"
							? // design-escape-ok(opacity): no role renders this; error/5 fill, error/15 ring
								"bg-error/5 text-error ring-error/15"
							: // design-escape-ok(opacity): no role renders this; field/35 fill, line/60 ring
								"bg-field/35 text-ink-3 ring-line/60",
					)}
				>
					{feedback.message}
				</div>
			) : null}

			{codeSentTo ? (
				<form onSubmit={submitCode} className="flex flex-col gap-xl">
					<Label className="sr-only" htmlFor="self-hosted-code">
						Email code
					</Label>
					<Input
						autoComplete="one-time-code"
						autoFocus
						className="form-input opaline-auth-code-input"
						id="self-hosted-code"
						inputMode="numeric"
						name="code"
						pattern="[0-9]*"
						placeholder="123456"
						value={code}
						onChange={(event) => {
							setCode(sanitizeEmailCodeInput(event.target.value));
							if (feedback?.kind === "error") setFeedback(null);
						}}
						required
					/>
					<Button className="form-button" type="submit" disabled={loading}>
						{loading ? "Verifying..." : "Verify code"}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="form-button text-ink-3"
						disabled={loading}
						onClick={() => {
							setCodeSentTo(null);
							setFeedback(null);
						}}
					>
						Use a password instead
					</Button>
				</form>
			) : (
				<form
					onSubmit={submitPassword}
					className="flex flex-col gap-xl"
					noValidate
				>
					{mode === "sign-up" ? (
						<div className="flex flex-col gap-m">
							<Label className="sr-only" htmlFor="self-hosted-name">
								Name
							</Label>
							<Input
								className="form-input"
								id="self-hosted-name"
								name="name"
								autoComplete="name"
								placeholder="Your name"
								value={name}
								maxLength={200}
								onChange={(event) => setName(event.target.value)}
								disabled={loading}
							/>
						</div>
					) : null}
					<div className="flex flex-col gap-m">
						<Label className="sr-only" htmlFor="self-hosted-email">
							Email
						</Label>
						<Input
							className="form-input"
							id="self-hosted-email"
							name="email"
							type="email"
							autoComplete="email"
							placeholder="you@example.com"
							value={email}
							onChange={(event) => {
								setEmail(event.target.value);
								if (feedback) setFeedback(null);
							}}
							disabled={loading}
							required
						/>
					</div>
					<div className="flex flex-col gap-m">
						<Label className="sr-only" htmlFor="self-hosted-password">
							Password
						</Label>
						<Input
							className="form-input"
							id="self-hosted-password"
							name="password"
							type="password"
							autoComplete={
								mode === "sign-in" ? "current-password" : "new-password"
							}
							placeholder={
								mode === "sign-in"
									? "Password"
									: "Password (8 characters or more)"
							}
							value={password}
							maxLength={MAX_PASSWORD_LENGTH}
							onChange={(event) => {
								setPassword(event.target.value);
								if (feedback?.kind === "error") setFeedback(null);
							}}
							disabled={loading}
							required
						/>
					</div>
					<Button className="form-button" type="submit" disabled={loading}>
						{mode === "sign-in"
							? loading
								? "Signing in..."
								: "Sign in"
							: loading
								? "Creating account..."
								: "Create account"}
					</Button>
					{emailCodes ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="form-button text-ink-3"
							disabled={loading}
							onClick={() => void sendCode()}
						>
							Email me a sign-in code instead
						</Button>
					) : null}
				</form>
			)}

			{mode === "sign-in" &&
			!isLocalDesktopApp(
				true,
				navigator.userAgent,
				window.location.hostname,
			) ? (
				<p className="text-center text-body-m text-ink-3">
					Running this server? <code>opaline server open</code> signs you in
					from its terminal.
				</p>
			) : null}

			<p className="text-center text-body-xl text-ink-3">
				{mode === "sign-in"
					? "Don't have an account? "
					: "Already have an account? "}
				<button
					type="button"
					onClick={switchMode}
					className="underline underline-offset-4 hover:text-primary"
				>
					{mode === "sign-in" ? "Create one" : "Sign in"}
				</button>
			</p>
		</div>
	);
}
