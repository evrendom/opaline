export function DesktopOnlyOverlay() {
	return (
		<div
			data-testid="desktop-only-overlay"
			// design-escape-ok(opacity): no role renders this; canvas/96 overlay
			className="fixed inset-0 z-[120] hidden items-center justify-center bg-canvas/96 px-xxl text-center backdrop-blur-sm max-[499px]:flex"
		>
			<p className="max-w-md text-body-xl text-ink-3">
				Please use it on desktop or resize your window. Otherwise it will look
				horrendous.
			</p>
		</div>
	);
}
