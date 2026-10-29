import type { ReactNode } from "react";
import { useState } from "react";
import { useTheme } from "@/app/providers/ThemeProvider";
import { readPendingEmailCodeDraft } from "@/features/auth/email-code-auth";
import { LoginForm } from "@/features/auth/LoginForm";
import { SignupForm } from "@/features/auth/SignupForm";
import { useRootMark } from "@/hooks/use-root-mark";
import "@/features/shell/website-button.css";
import "./guest-app.css";

type Page = "login" | "signup";

interface GuestAppProps {
	description?: ReactNode;
	eyebrow?: string;
	showLogo?: boolean;
	title?: string;
}

export function GuestApp(props: GuestAppProps = {}) {
	const { description, eyebrow, showLogo = true, title } = props;
	const { resolvedTheme } = useTheme();
	useRootMark("data-auth-shell");
	const [page, setPage] = useState<Page>(
		() => readPendingEmailCodeDraft()?.mode ?? "login",
	);
	const pageTitle =
		title ?? (page === "login" ? "Welcome back" : "Create your account");
	const pageDescription =
		description ??
		(page === "login"
			? "Sign in to continue to Opaline."
			: "Create an account to start exploring your coding sessions.");

	return (
		<div className="opaline-auth-shell">
			<main className="opaline-auth-main">
				<div className="opaline-auth-content">
					<div className="opaline-auth-intro">
						{showLogo ? (
							<img
								className="opaline-auth-mark"
								src={
									resolvedTheme === "dark"
										? "/opaline-icon-dark.svg"
										: "/opaline-icon.svg"
								}
								alt="Opaline"
							/>
						) : null}
						{eyebrow ? <p className="opaline-auth-eyebrow">{eyebrow}</p> : null}
						<h1>{pageTitle}</h1>
						<p>{pageDescription}</p>
					</div>

					{page === "login" ? (
						<LoginForm />
					) : (
						<SignupForm onSwitchToLogin={() => setPage("login")} />
					)}
				</div>
			</main>
		</div>
	);
}
