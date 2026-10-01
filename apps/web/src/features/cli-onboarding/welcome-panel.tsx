import { ChevronLeftIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { ProductBrand } from "@/features/shell/components/product-brand";

const ProgressTarget = createContext<HTMLDivElement | null>(null);
const STEPS = ["Sign in", "Workspace", "Profile", "Invite"];

export function WelcomePanel({ children }: { children: ReactNode }) {
	const [progressTarget, setProgressTarget] = useState<HTMLDivElement | null>(
		null,
	);
	return (
		<div className="cli-welcome-panel-content">
			<header className="cli-welcome-brand-row">
				<a
					className="cli-welcome-brand"
					href="/home"
					aria-label="Opaline website"
				>
					<ProductBrand />
				</a>
				<div ref={setProgressTarget} />
			</header>
			<div className="cli-welcome-body">
				<ProgressTarget.Provider value={progressTarget}>
					<section
						className="cli-onboarding-surface cli-welcome-form"
						data-cli-onboarding-surface
					>
						{children}
					</section>
				</ProgressTarget.Provider>
			</div>
			<footer className="cli-welcome-footer">
				<p>Pull back the curtain on your coding sessions.</p>
				<nav aria-label="Legal">
					<a href="/legal/privacy-policy" target="_blank" rel="noreferrer">
						Privacy
					</a>
					<a href="/legal/terms-of-service" target="_blank" rel="noreferrer">
						Terms
					</a>
				</nav>
			</footer>
		</div>
	);
}

export function WelcomeBack({
	onClick,
	disabled,
}: {
	onClick: () => void;
	disabled: boolean;
}) {
	return (
		<button
			type="button"
			className="cli-welcome-back"
			onClick={onClick}
			disabled={disabled}
		>
			<ChevronLeftIcon size={16} aria-hidden="true" />
			Back
		</button>
	);
}

export function WelcomeProgress({
	step,
	includeGitHub = false,
}: {
	step: 1 | 2 | 3 | 4 | 5;
	includeGitHub?: boolean;
}) {
	const steps = includeGitHub
		? ["Sign in", "Workspace", "GitHub", "Profile", "Invite"]
		: STEPS;
	const target = useContext(ProgressTarget);
	if (!target) return null;
	return createPortal(
		<nav
			className="cli-welcome-progress"
			aria-label={`Step ${step} of ${steps.length}: ${steps[step - 1]}`}
		>
			<ol aria-label="Setup progress">
				{steps.map((label, index) => (
					<li
						key={label}
						aria-label={label}
						aria-current={index + 1 === step ? "step" : undefined}
						data-complete={index + 1 <= step}
					/>
				))}
			</ol>
		</nav>,
		target,
	);
}
