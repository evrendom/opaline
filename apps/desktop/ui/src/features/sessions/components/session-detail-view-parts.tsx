import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { Component, type ReactNode } from "react";
import { Button, buttonVariants } from "@/app/ui/button";
import { EmptyState } from "@/components/dashboard/page-parts";

type SessionDetailErrorBoundaryProps = {
	children: ReactNode;
	fallbackHref: string;
};

type SessionDetailErrorBoundaryState = {
	hasError: boolean;
};

export class SessionDetailErrorBoundary extends Component<
	SessionDetailErrorBoundaryProps,
	SessionDetailErrorBoundaryState
> {
	override state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	override componentDidCatch(error: unknown) {
		console.error("[SessionDetailView] Failed to render session detail", error);
	}

	override render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col p-xxxl">
					<EmptyState
						icon={IconAlertTriangle}
						title="This session couldn’t be shown"
						description="Something broke while rendering it. The rest of the workspace still works."
					>
						<div className="mt-m flex flex-wrap justify-center gap-m">
							<Button
								onClick={() => window.location.reload()}
								type="button"
								variant="primary"
							>
								<IconRefresh />
								Reload
							</Button>
							<a
								className={buttonVariants({ variant: "secondary" })}
								href={this.props.fallbackHref}
							>
								Back to sessions
							</a>
						</div>
					</EmptyState>
				</div>
			);
		}

		return this.props.children;
	}
}
