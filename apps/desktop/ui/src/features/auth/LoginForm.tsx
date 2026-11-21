import { type FormEvent, useState } from "react";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import { Label } from "@/app/ui/label";
import { Separator } from "@/app/ui/separator";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { authClient, refreshAuthClientState } from "@/lib/auth-client";
import { formatAuthErrorMessage } from "@/lib/auth-error-message";
import { cn } from "@/lib/utils";
import { navigateToDestination } from "./auth-navigation";
import {
	clearPendingSignupRedirect,
	getEmailLoginSuccessDestination,
	getSocialLoginRedirectOptions,
} from "./auth-route-utils";
import {
	clearPendingEmailLoginCodeDraft,
	type EmailAuthFeedback,
	type EmailCodeStage,
	isValidAuthEmail,
	isValidEmailCode,
	normalizeAuthEmail,
	readPendingEmailLoginCodeDraft,
	sanitizeEmailCodeInput,
	writePendingEmailLoginCodeDraft,
} from "./email-code-auth";
import {
	recordOAuthRedirectResult,
	recordOAuthRedirectStart,
} from "./oauth-debug";
import { usePasswordSignIn } from "./password-sign-in";

const LOGIN_CODE_INPUT_ID = "login-code";

interface LoginFormProps {
	hideSwitchPrompt?: boolean;
}

export function LoginForm(props: LoginFormProps = {}) {
	const { hideSwitchPrompt = false } = props;
	const [initialLoginDraft] = useState(readPendingEmailLoginCodeDraft);
	const [email, setEmail] = useState(() => initialLoginDraft?.email ?? "");
	const [password, setPassword] = useState("");
	const [emailCode, setEmailCode] = useState("");
	const [emailCodeStage, setEmailCodeStage] = useState<EmailCodeStage>(() =>
		initialLoginDraft ? "code" : "email",
	);
	const [feedback, setFeedback] = useState<EmailAuthFeedback>(() =>
		initialLoginDraft
			? {
					kind: "success",
					message: `Code sent to ${initialLoginDraft.email}.`,
				}
			: null,
	);
	const [loading, setLoading] = useState(false);
	const [showEmailForm, setShowEmailForm] = useState(
		() => initialLoginDraft !== null,
	);
	const { trackAuthenticationAction } = useAnalyticsTracking({
		pageName: "login",
	});
	const hasValidEmail = isValidAuthEmail(email);
	const hasValidEmailCode = isValidEmailCode(emailCode);
	const isVerifyingEmail = showEmailForm && emailCodeStage === "code";
	// Only PASSWORD_AUTH_EMAILS accounts see a password field; everyone else
	// gets an email code. Allowed accounts may still choose an email code,
	// since an account created with a code has no password.
	const [emailCodeChosenFor, setEmailCodeChosenFor] = useState<string | null>(
		null,
	);
	const passwordAllowed =
		usePasswordSignIn(email) && emailCodeStage === "email";
	const passwordSignIn =
		passwordAllowed && emailCodeChosenFor !== normalizeAuthEmail(email);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setFeedback(null);
		const loginEmail = normalizeAuthEmail(email);

		if (emailCodeStage === "email" && !passwordSignIn) {
			await sendEmailCode();
			return;
		}

		if (!passwordSignIn && !hasValidEmailCode) {
			const codeField = document.getElementById(LOGIN_CODE_INPUT_ID);
			if (codeField instanceof HTMLInputElement) {
				codeField.focus();
			}
			setFeedback({
				kind: "error",
				message: "Enter the 6-digit code from your email.",
			});
			return;
		}

		const successDestination = getEmailLoginSuccessDestination();
		trackAuthenticationAction({
			actionName: "sign_in",
			sourceComponent: "login_form",
			authMethod: passwordSignIn ? "email_password" : "email_otp",
		});
		clearPendingSignupRedirect();
		setLoading(true);
		const { error } = passwordSignIn
			? await authClient.signIn.email({ email: loginEmail, password })
			: await authClient.signIn.emailOtp({
					email: loginEmail,
					otp: emailCode,
				});
		setLoading(false);
		if (error) {
			setFeedback({
				kind: "error",
				message: formatAuthErrorMessage({
					error,
					fallbackMessage: "Sign in failed",
					operation: passwordSignIn ? "password sign in" : "email code sign in",
				}),
			});
			return;
		}

		clearPendingEmailLoginCodeDraft();
		refreshAuthClientState();
		navigateToDestination(successDestination);
	}

	async function sendEmailCode() {
		setFeedback(null);
		const loginEmail = normalizeAuthEmail(email);

		if (!hasValidEmail) {
			const emailField = document.getElementById("email");
			if (emailField instanceof HTMLInputElement) {
				emailField.focus();
			}
			setFeedback({
				kind: "error",
				message: "Enter a valid email to continue.",
			});
			return;
		}

		trackAuthenticationAction({
			actionName: "request_email_code",
			sourceComponent: "login_form",
			authMethod: "email_otp",
		});
		setLoading(true);
		const { error } = await authClient.emailOtp.sendVerificationOtp({
			email: loginEmail,
			type: "sign-in",
		});
		setLoading(false);

		if (error) {
			setFeedback({
				kind: "error",
				message: formatAuthErrorMessage({
					error,
					fallbackMessage: "Could not send the email code",
					operation: "email code request",
				}),
			});
			return;
		}

		setEmail(loginEmail);
		setEmailCode("");
		setEmailCodeStage("code");
		writePendingEmailLoginCodeDraft(loginEmail);
		setFeedback({
			kind: "success",
			message: `Code sent to ${loginEmail}.`,
		});
	}

	async function handleSocialSignIn(provider: "google" | "github") {
		clearPendingEmailLoginCodeDraft();
		setFeedback(null);
		trackAuthenticationAction({
			actionName: "sign_in",
			sourceComponent: "login_form",
			authMethod: provider,
		});
		const { callbackURL, newUserCallbackURL } = getSocialLoginRedirectOptions();
		recordOAuthRedirectStart({
			callbackURL,
			newUserCallbackURL,
			provider,
			source: "login_form",
		});
		const { error } = await authClient.signIn.social({
			provider,
			callbackURL,
			newUserCallbackURL,
		});
		recordOAuthRedirectResult({
			errorMessage: error?.message,
			provider,
			source: "login_form",
		});
		if (error) {
			setFeedback({
				kind: "error",
				message: formatAuthErrorMessage({
					error,
					fallbackMessage: `Sign in with ${provider} failed`,
					operation: `${provider} social sign in`,
				}),
			});
		}
	}

	function handleEmailChange(value: string) {
		setEmail(value);
		if (feedback) {
			setFeedback(null);
		}
	}

	function handleEmailCodeChange(value: string) {
		setEmailCode(sanitizeEmailCodeInput(value));
		if (feedback?.kind === "error") {
			setFeedback(null);
		}
	}

	return (
		<div className="w-full max-w-sm">
			{isVerifyingEmail ? (
				<div
					key="verify-email"
					className="opaline-auth-stage opaline-email-verification"
				>
					<div className="opaline-email-verification-intro">
						<p id="login-code-delivery">Sent email to {email}.</p>
						<button
							type="button"
							disabled={loading}
							onClick={() => {
								clearPendingEmailLoginCodeDraft();
								setFeedback(null);
								setEmailCode("");
								setEmailCodeStage("email");
							}}
							className="opaline-auth-email-switch"
						>
							Use another one
							<span aria-hidden="true" />
						</button>
					</div>

					{feedback?.kind === "error" ? (
						<div
							role="alert"
							aria-live="polite"
							className={
								/* design-escape-ok(opacity): no role renders this; error at 5% fill, 15% ring */ "corner-m bg-error/5 px-l py-m text-error ring-1 ring-error/15"
							}
						>
							{feedback.message}
						</div>
					) : null}

					<form onSubmit={handleSubmit} className="flex flex-col gap-xl">
						<Label className="sr-only" htmlFor={LOGIN_CODE_INPUT_ID}>
							Email code
						</Label>
						<Input
							aria-describedby="login-code-delivery"
							autoComplete="one-time-code"
							autoFocus
							className="form-input opaline-auth-code-input"
							id={LOGIN_CODE_INPUT_ID}
							inputMode="numeric"
							name="code"
							pattern="[0-9]*"
							placeholder="123456"
							value={emailCode}
							onChange={(e) => {
								handleEmailCodeChange(e.target.value);
							}}
							required
						/>
						<Button className="form-button" type="submit" disabled={loading}>
							{loading ? "Verifying..." : "Verify code"}
						</Button>
					</form>
				</div>
			) : (
				<div
					key="login-options"
					className="opaline-auth-stage flex flex-col gap-xl"
				>
					<div className="flex flex-col gap-m">
						<Button
							type="button"
							className="form-button opaline-website-primary-button"
							onClick={() => handleSocialSignIn("github")}
						>
							<span>Log in with GitHub</span>
						</Button>
						<Button
							className="form-button"
							type="button"
							variant="outline"
							onClick={() => handleSocialSignIn("google")}
						>
							Log in with Google
						</Button>
					</div>

					<div className="flex items-center gap-m">
						<Separator className="flex-1" />
						<span className="text-body-m text-ink-3">OR</span>
						<Separator className="flex-1" />
					</div>

					{feedback ? (
						<div
							role={feedback.kind === "error" ? "alert" : "status"}
							aria-live="polite"
							className={cn(
								"corner-xl px-l py-m text-body-xl ring-1",
								feedback.kind === "error"
									? // design-escape-ok(opacity): no role renders this; error at 5% fill, 15% ring
										"bg-error/5 text-error ring-error/15"
									: "bg-inset text-ink-3 ring-line-soft",
								"whitespace-pre-line",
							)}
						>
							{feedback.message}
						</div>
					) : null}

					{showEmailForm ? (
						<form onSubmit={handleSubmit} className="flex flex-col gap-xl">
							<div className="flex flex-col gap-m">
								<Label className="sr-only" htmlFor="email">
									Email
								</Label>
								<Input
									className="form-input"
									disabled={emailCodeStage === "code"}
									id="email"
									name="email"
									type="email"
									autoComplete="email"
									placeholder="you@example.com"
									value={email}
									onChange={(e) => {
										handleEmailChange(e.target.value);
									}}
									required
								/>
							</div>
							{passwordSignIn ? (
								<div className="flex flex-col gap-m">
									<Label className="sr-only" htmlFor="password">
										Password
									</Label>
									<Input
										className="form-input"
										id="password"
										name="password"
										type="password"
										autoComplete="current-password"
										placeholder="Password"
										value={password}
										onChange={(e) => {
											setPassword(e.target.value);
											setFeedback(null);
										}}
										disabled={loading}
										required
									/>
								</div>
							) : null}
							<Button className="form-button" type="submit" disabled={loading}>
								{passwordSignIn
									? loading
										? "Signing in..."
										: "Sign in"
									: loading
										? "Sending code..."
										: "Send code"}
							</Button>
							{passwordAllowed ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="form-button text-ink-3"
									disabled={loading}
									onClick={() => {
										setEmailCodeChosenFor(
											passwordSignIn ? normalizeAuthEmail(email) : null,
										);
										setPassword("");
										setFeedback(null);
									}}
								>
									{passwordSignIn
										? "Use an email code instead"
										: "Use a password instead"}
								</Button>
							) : null}
						</form>
					) : (
						<Button
							className="form-button"
							type="button"
							variant="outline"
							onClick={() => {
								setFeedback(null);
								setEmailCode("");
								setEmailCodeStage("email");
								setShowEmailForm(true);
							}}
						>
							Log in with Email
						</Button>
					)}

					<p className="text-center text-body-m text-ink-3">
						By signing up, you agree to our{" "}
						<a
							href="https://opaline.so/terms"
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-4 hover:text-primary"
						>
							Terms of Service
						</a>{" "}
						and{" "}
						<a
							href="https://opaline.so/privacy"
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-4 hover:text-primary"
						>
							Privacy Policy
						</a>
					</p>

					{hideSwitchPrompt ? null : (
						<p className="text-center text-body-xl text-ink-3">
							Don&apos;t have an account?{" "}
							<a
								href="/welcome"
								onClick={() => {
									clearPendingEmailLoginCodeDraft();
									trackAuthenticationAction({
										actionName: "open_signup",
										sourceComponent: "login_form",
									});
								}}
								className="underline underline-offset-4 hover:text-primary"
							>
								Get started
							</a>
						</p>
					)}
				</div>
			)}
		</div>
	);
}
