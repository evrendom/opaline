import type { ReactNode } from "react";
import { useState } from "react";
import { useTheme } from "@/app/providers/ThemeProvider";
import { SelfHostedAuthForm } from "@/features/self-hosted/SelfHostedAuthForm";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import {
	initialSelfHostedAuthMode,
	selfHostedAuthCopy,
} from "@/features/self-hosted/self-hosted-auth";
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
	const selfHost = useSelfHost();
	useRootMark("data-auth-shell");
	const [page, setPage] = useState<Page>(() =>
		selfHost &&
		initialSelfHostedAuthMode(selfHost, window.location.pathname) === "sign-up"
			? "signup"
			: "login",
	);
	const selfHostedCopy = selfHost
		? selfHostedAuthCopy(page === "login" ? "sign-in" : "sign-up", {
				info: selfHost,
				pathname: window.location.pathname,
				search: window.location.search,
			})
		: null;
	const pageTitle =
		title ??
		selfHostedCopy?.title ??
		(page === "login" ? "Welcome back" : "Create your account");
	const pageDescription =
		description ??
		selfHostedCopy?.description ??
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

					{selfHost ? (
						<SelfHostedAuthForm
							mode={page === "login" ? "sign-in" : "sign-up"}
							info={selfHost}
							onSwitchMode={() =>
								setPage((current) => (current === "login" ? "signup" : "login"))
							}
						/>
					) : null}
				</div>
			</main>
		</div>
	);
}
