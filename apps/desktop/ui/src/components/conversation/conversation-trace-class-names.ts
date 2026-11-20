export const conversationTraceLabelClassName =
	"shrink-0 font-body text-body-m font-regular text-ink/[0.608] dark:text-ink/[0.685]";

// Sticky headers alone need an opaque pane-colored surface: it masks rails
// that keep scrolling underneath without turning ordinary rows into cards.
export const conversationTraceStickyOnlyFillClassName =
	"[&_*:not([data-trace-icon]):not([data-trace-tree-line]):not([data-trace-tree-sticky-surface]):not([data-trace-code-block]):not([data-trace-code-block]_*):not([data-signal]):not([data-search-highlight])]:!bg-transparent [&_*:not([data-trace-icon]):not([data-trace-tree-line]):not([data-trace-tree-sticky-surface]):not([data-trace-code-block]):not([data-trace-code-block]_*):not([data-signal]):not([data-search-highlight])]:!bg-none";

export const conversationTracePreviewClassName =
	"min-w-0 flex-1 truncate font-body text-body-l font-regular tracking-m text-ink group-aria-expanded:invisible";

export const conversationTraceProsePreviewClassName =
	"min-w-0 flex-1 line-clamp-3 whitespace-normal font-sans text-body-l font-normal text-ink group-aria-expanded:invisible";

export const conversationTraceSignalAwarePreviewClassName =
	"min-w-0 flex-1 font-body text-body-l font-regular tracking-m text-ink group-aria-expanded:invisible";
