import {
	type Icon,
	IconAlertCircle,
	IconClock,
	IconCoin,
	IconCpu,
	IconFolder,
	IconSitemap,
	IconSparkles,
	IconStack2,
	IconUser,
} from "@tabler/icons-react";
import type {
	SessionOverviewFilterKey,
	SessionOverviewRangeFilterKey,
} from "@/features/sessions/components/sessions-overview-table-utils";

export type SessionOverviewToolbarFilter =
	| {
			group: "identity" | "usage" | "activity";
			icon: Icon;
			kind: "options";
			key: SessionOverviewFilterKey;
			label: string;
	  }
	| {
			group: "identity" | "usage" | "activity";
			icon: Icon;
			kind: "range";
			key: SessionOverviewRangeFilterKey;
			label: string;
	  }
	| {
			group: "identity" | "usage" | "activity";
			icon: Icon;
			kind: "token-ranges";
			key: "tokens";
			label: string;
	  };

export const SESSION_OVERVIEW_TOOLBAR_FILTERS = [
	{
		group: "identity",
		icon: IconFolder,
		key: "repository",
		kind: "options",
		label: "Repository",
	},
	{
		group: "identity",
		icon: IconUser,
		key: "user",
		kind: "options",
		label: "Member",
	},
	{
		group: "identity",
		icon: IconCpu,
		key: "model",
		kind: "options",
		label: "Model",
	},
	{
		group: "usage",
		icon: IconClock,
		key: "duration",
		kind: "range",
		label: "Length",
	},
	{
		group: "usage",
		icon: IconStack2,
		key: "tokens",
		kind: "token-ranges",
		label: "Tokens",
	},
	{
		group: "usage",
		icon: IconCoin,
		key: "cost",
		kind: "range",
		label: "Cost",
	},
	{
		group: "activity",
		icon: IconAlertCircle,
		key: "errors",
		kind: "range",
		label: "Errors",
	},
	{
		group: "activity",
		icon: IconSparkles,
		key: "skills",
		kind: "options",
		label: "Skills",
	},
	{
		group: "activity",
		icon: IconSitemap,
		key: "subagents",
		kind: "range",
		label: "Subagent types",
	},
] satisfies readonly SessionOverviewToolbarFilter[];
