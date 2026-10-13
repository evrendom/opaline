import { Component, type ReactNode } from "react";

/** Live views are extra: a rendering failure hides them, never the page. */
export class LiveSessionErrorBoundary extends Component<
	{ children: ReactNode; fallback?: ReactNode },
	{ hasError: boolean }
> {
	override state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	override componentDidCatch(error: unknown) {
		console.error("[LiveSession] Failed to render the live session", error);
	}

	override render() {
		return this.state.hasError
			? (this.props.fallback ?? null)
			: this.props.children;
	}
}
