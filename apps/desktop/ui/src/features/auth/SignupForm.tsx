import { type FormEvent, useState } from "react";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import { Label } from "@/app/ui/label";
import { Separator } from "@/app/ui/separator";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { authClient, refreshAuthClientState } from "@/lib/auth-client";
import { getInitialSignupName } from "@/lib/auth-signup-name";
import {
	captureSignUpFailed,
	normalizeWebErrorCode,
} from "@/lib/product-analytics";
import { cn } from "@/lib/utils";
import { navigateToDestination } from "./auth-navigation";
import {
	clearPendingSignupRedirect,
	getEmailSignupSuccessDestination,
	getSocialSignupRedirectOptions,
	primePendingSignupRedirect,
} from "./auth-route-utils";
import {
	clearPendingEmailCodeDraft,
	type EmailAuthFeedback,
	type EmailCodeStage,
	isValidAuthEmail,
	isValidEmailCode,
	normalizeAuthEmail,
	readPendingEmailSignupCodeDraft,
	sanitizeEmailCodeInput,
	writePendingEmailSignupCodeDraft,
} from "./email-code-auth";
import {
	recordOAuthRedirectResult,
	recordOAuthRedirectStart,
} from "./oauth-debug";

const SIGNUP_CODE_INPUT_ID = "signup-code";

function getSignupContext() {
	const params = new URLSearchParams(window.location.search);
	const redirect = params.get("redirect");
	const userCode = params.get("user_code");
	const path = window.location.pathname;

	const entryPoint:
		| "homepage"
		| "cli_device_login"
		| "accept_invitation"
		| "direct" = userCode
		? "cli_device_login"
		: path.startsWith("/invitation/") || redirect?.includes("/invitation/")
			? "accept_invitation"
			: path === "/" || path === ""
				? "homepage"
				: "direct";

	return {
		entryPoint,
		isInviteFlow:
			path.startsWith("/invitation/") ||
			redirect?.includes("/invitation/") ||
			false,
	};
}

interface SignupFormProps {
	hideSwitchPrompt?: boolean;
	onSwitchToLogin: () => void;
}

export function SignupForm(props: SignupFormProps) {
	const { hideSwitchPrompt = false, onSwitchToLogin } = props;
	const [initialSignupDraft] = useState(readPendingEmailSignupCodeDraft);
	const [email, setEmail] = useState(() => initialSignupDraft?.email ?? "");
	const [emailCode, setEmailCode] = useState("");
	const [emailCodeStage, setEmailCodeStage] = useState<EmailCodeStage>(() =>
		initialSignupDraft ? "code" : "email",
	);
	const [feedback, setFeedback] = useState<EmailAuthFeedback>(() =>
		initialSignupDraft
			? {
					kind: "success",
					message: `Code sent to ${initialSignupDraft.email}.`,
				}
			: null,
	);
	const [loading, setLoading] = useState(false);
	const [showEmailForm, setShowEmailForm] = useState(
		() => initialSignupDraft !== null,
	);
	const { trackAuthenticationAction } = useAnalyticsTracking({
		pageName: "signup",
	});
	const hasValidEmail = isValidAuthEmail(email);
	const hasValidEmailCode = isValidEmailCode(emailCode);
	const isVerifyingEmail = showEmailForm && emailCodeStage === "code";

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setFeedback(null);
		const signupEmail = normalizeAuthEmail(email);

		if (emailCodeStage === "email") {
			await sendEmailCode();
			return;
		}

		if (!hasValidEmailCode) {
			const codeField = document.getElementById(SIGNUP_CODE_INPUT_ID);
			if (codeField instanceof HTMLInputElement) {
				codeField.focus();
			}
			setFeedback({
				kind: "error",
				message: "Enter the 6-digit code from your email.",
			});
			return;
		}

		setLoading(true);
		const successDestination = getEmailSignupSuccessDestination();
		primePendingSignupRedirect(successDestination);
		const signupContext = getSignupContext();
		trackAuthenticationAction({
			actionName: "sign_up",
			sourceComponent: "signup_form",
			authMethod: "email_otp",
			entrypoint: signupContext.entryPoint,
		});
		const { error } = await authClient.signIn.emailOtp({
			name: getInitialSignupName(signupEmail),
			email: signupEmail,
			otp: emailCode,
		});
		setLoading(false);
		if (error) {
			captureSignUpFailed({
				signup_method: "email_otp",
				failure_stage: "form_submit",
				error_code: normalizeWebErrorCode(error),
				is_invite_flow: signupContext.isInviteFlow || undefined,
				entry_point: signupContext.entryPoint,
			});
			setFeedback({
				kind: "error",
				message: error.message ?? "Sign up failed",
			});
			return;
		}

		clearPendingEmailCodeDraft();
		refreshAuthClientState();
		navigateToDestination(successDestination);
	}

	async function sendEmailCode() {
		setFeedback(null);
		const signupEmail = normalizeAuthEmail(email);

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

		const signupContext = getSignupContext();
		trackAuthenticationAction({
			actionName: "request_email_code",
			sourceComponent: "signup_form",
			authMethod: "email_otp",
			entrypoint: signupContext.entryPoint,
		});
		setLoading(true);
		const successDestination = getEmailSignupSuccessDestination();
		primePendingSignupRedirect(successDestination);
		const { error } = await authClient.emailOtp.sendVerificationOtp({
			email: signupEmail,
			type: "sign-in",
		});
		setLoading(false);

		if (error) {
			clearPendingSignupRedirect();
			captureSignUpFailed({
				signup_method: "email_otp",
				failure_stage: "form_submit",
				error_code: normalizeWebErrorCode(error),
				is_invite_flow: signupContext.isInviteFlow || undefined,
				entry_point: signupContext.entryPoint,
			});
			setFeedback({
				kind: "error",
				message: error.message ?? "Could not send the email code",
			});
			return;
		}

		setEmail(signupEmail);
		setEmailCode("");
		setEmailCodeStage("code");
		writePendingEmailSignupCodeDraft(signupEmail);
		setFeedback({
			kind: "success",
			message: `Code sent to ${signupEmail}.`,
		});
	}

	async function handleSocialSignIn(provider: "google" | "github") {
		clearPendingEmailCodeDraft();
		setFeedback(null);
		const { callbackURL, newUserCallbackURL } =
			getSocialSignupRedirectOptions();
		const signupContext = getSignupContext();
		trackAuthenticationAction({
			actionName: "sign_up",
			sourceComponent: "signup_form",
			authMethod: provider,
			entrypoint: signupContext.entryPoint,
		});
		recordOAuthRedirectStart({
			callbackURL,
			newUserCallbackURL,
			provider,
			source: "signup_form",
		});
		const { error } = await authClient.signIn.social({
			provider,
			callbackURL,
			newUserCallbackURL,
		});
		recordOAuthRedirectResult({
			errorMessage: error?.message,
			provider,
			source: "signup_form",
		});
		if (error) {
			captureSignUpFailed({
				signup_method: provider,
				failure_stage: "provider_redirect",
				error_code: normalizeWebErrorCode(error),
				is_invite_flow: signupContext.isInviteFlow || undefined,
				entry_point: signupContext.entryPoint,
			});
			setFeedback({
				kind: "error",
				message: error.message ?? `Sign up with ${provider} failed`,
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
						<p id="signup-code-delivery">Sent email to {email}.</p>
						<button
							type="button"
							disabled={loading}
							onClick={() => {
								clearPendingEmailCodeDraft();
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
							className="corner-m bg-error/5 px-l py-m text-error ring-1 ring-error/15"
						>
							{feedback.message}
						</div>
					) : null}

					<form onSubmit={handleSubmit} className="flex flex-col gap-xl">
						<Label className="sr-only" htmlFor={SIGNUP_CODE_INPUT_ID}>
							Email code
						</Label>
						<Input
							aria-describedby="signup-code-delivery"
							autoComplete="one-time-code"
							autoFocus
							className="form-input opaline-auth-code-input"
							id={SIGNUP_CODE_INPUT_ID}
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
					key="signup-options"
					className="opaline-auth-stage flex flex-col gap-xl"
				>
					<div className="flex flex-col gap-m">
						<Button
							type="button"
							className="form-button opaline-website-primary-button"
							onClick={() => handleSocialSignIn("github")}
						>
							<span>Create account with GitHub</span>
						</Button>
						<Button
							className="form-button"
							type="button"
							variant="outline"
							onClick={() => handleSocialSignIn("google")}
						>
							Create account with Google
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
									? "bg-error/5 text-error ring-error/15"
									: "bg-field/35 text-ink-3 ring-line/60",
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
									autoComplete="email"
									disabled={emailCodeStage === "code"}
									id="email"
									name="email"
									type="email"
									placeholder="you@example.com"
									value={email}
									onChange={(e) => {
										handleEmailChange(e.target.value);
									}}
									required
								/>
							</div>
							<Button className="form-button" type="submit" disabled={loading}>
								{loading ? "Sending code..." : "Send code"}
							</Button>
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
							Create account with Email
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
							Already have an account?{" "}
							<button
								type="button"
								onClick={() => {
									clearPendingEmailCodeDraft();
									trackAuthenticationAction({
										actionName: "open_login",
										sourceComponent: "signup_form",
									});
									onSwitchToLogin();
								}}
								className="underline underline-offset-4 hover:text-primary"
							>
								Sign in
							</button>
						</p>
					)}
				</div>
			)}
		</div>
	);
}
