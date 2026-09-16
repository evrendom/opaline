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

const LOGIN_CODE_INPUT_ID = "login-code";

interface LoginFormProps {
	hideSwitchPrompt?: boolean;
	onSwitchToSignup: () => void;
}

export function LoginForm(props: LoginFormProps) {
	const { hideSwitchPrompt = false, onSwitchToSignup } = props;
	const [initialLoginDraft] = useState(readPendingEmailLoginCodeDraft);
	const [email, setEmail] = useState(() => initialLoginDraft?.email ?? "");
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

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setFeedback(null);
		const loginEmail = normalizeAuthEmail(email);

		if (emailCodeStage === "email") {
			await sendEmailCode();
			return;
		}

		if (!hasValidEmailCode) {
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
			authMethod: "email_otp",
		});
		clearPendingSignupRedirect();
		setLoading(true);
		const { error } = await authClient.signIn.emailOtp({
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
					operation: "email code sign in",
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
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => handleSocialSignIn("google")}
					>
						Log in with Google
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => handleSocialSignIn("github")}
					>
						Log in with GitHub
					</Button>
				</div>

				<div className="flex items-center gap-2">
					<Separator className="flex-1" />
					<span className="text-xs text-muted-foreground">OR</span>
					<Separator className="flex-1" />
				</div>

				{feedback ? (
					<div
						role={feedback.kind === "error" ? "alert" : "status"}
						aria-live="polite"
						className={cn(
							"rounded-3xl px-3 py-2 text-sm leading-5 ring-1",
							feedback.kind === "error"
								? "bg-destructive/5 text-destructive ring-destructive/15"
								: "bg-muted/35 text-muted-foreground ring-border/60",
							"whitespace-pre-line",
						)}
					>
						{feedback.message}
					</div>
				) : null}

				{showEmailForm ? (
					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="email">Email</Label>
							<Input
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
						{emailCodeStage === "code" ? (
							<div className="flex flex-col gap-2">
								<Label htmlFor={LOGIN_CODE_INPUT_ID}>Email code</Label>
								<Input
									autoComplete="one-time-code"
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
								<Button
									type="button"
									variant="ghost"
									size="xs"
									onClick={() => {
										clearPendingEmailLoginCodeDraft();
										setFeedback(null);
										setEmailCode("");
										setEmailCodeStage("email");
									}}
									className="self-start px-0 text-muted-foreground hover:text-foreground"
								>
									Use a different email
								</Button>
							</div>
						) : null}
						<Button type="submit" disabled={loading}>
							{emailCodeStage === "code"
								? loading
									? "Verifying..."
									: "Verify code"
								: loading
									? "Sending code..."
									: "Send code"}
						</Button>
					</form>
				) : (
					<Button
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

				<p className="text-center text-xs text-muted-foreground">
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
					<p className="text-center text-sm text-muted-foreground">
						Don&apos;t have an account?{" "}
						<button
							type="button"
							onClick={() => {
								clearPendingEmailLoginCodeDraft();
								trackAuthenticationAction({
									actionName: "open_signup",
									sourceComponent: "login_form",
								});
								onSwitchToSignup();
							}}
							className="underline underline-offset-4 hover:text-primary"
						>
							Sign up
						</button>
					</p>
				)}
			</div>
		</div>
	);
}
