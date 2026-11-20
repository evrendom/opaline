export function ConversationTracePlanTag() {
	return (
		<span
			// design-escape-ok: 10/12 tag; no step (listed)
			className="shrink-0 corner-xs bg-inset px-s py-xxs text-[0.625rem]/3 font-medium text-ink-3"
			data-trace-plan-tag
		>
			Plan
		</span>
	);
}
