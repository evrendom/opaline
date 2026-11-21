import type { ReactNode } from "react";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { ProductBrand } from "@/features/shell/components/product-brand";

export function WelcomePanel({ children }: { children: ReactNode }) {
	const selfHost = useSelfHost();
	return (
		<div className="cli-welcome-panel-content">
			<header className="cli-welcome-brand-row">
				<a
					className="cli-welcome-brand"
					href={selfHost ? "/" : "/home"}
					aria-label={selfHost ? "Opaline" : "Opaline website"}
				>
					<ProductBrand />
				</a>
			</header>
			<div className="cli-welcome-body">
				<section
					className="cli-onboarding-surface cli-welcome-form"
					data-cli-onboarding-surface
				>
					{children}
				</section>
			</div>
			<footer className="cli-welcome-footer">
				<p>Pull back the curtain on your coding sessions.</p>
				{selfHost ? null : (
					<nav aria-label="Legal">
						<a href="/legal/privacy-policy" target="_blank" rel="noreferrer">
							Privacy
						</a>
						<a href="/legal/terms-of-service" target="_blank" rel="noreferrer">
							Terms
						</a>
					</nav>
				)}
			</footer>
		</div>
	);
}
