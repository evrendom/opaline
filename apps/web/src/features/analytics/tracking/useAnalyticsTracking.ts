import { useLocation } from "react-router-dom";
import { useOptionalDateRange } from "@/features/analytics/date-range/useDateRange";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { authClient } from "@/lib/auth-client";
import {
	type AppPageName,
	captureAuthenticationActionTriggered,
	captureDashboardDrilldownOpened,
	captureDashboardFilterChanged,
	captureOrganizationActionTriggered,
	type DashboardPageName,
	getAnalyticsPageName,
	isDashboardPageName,
} from "@/lib/product-analytics";

export interface UseAnalyticsOptions {
	organizationId?: string | null;
	pageName?: AppPageName | null;
}

type ProductAnalyticsActionResult = "started" | "succeeded" | "failed";

type AnalyticsOverrides = {
	dateRangeDays?: number;
	organizationId?: string | null;
	sourceComponent?: string;
	userId?: string | null;
};

type AnalyticsPayload = {
	page_name: AppPageName;
	organization_id?: string;
	user_id?: string;
	date_range_days?: number;
	source_component?: string;
};

type DashboardAnalyticsPayload = AnalyticsPayload & {
	page_name: DashboardPageName;
	organization_id: string;
	user_id: string;
};

function normalizeOptionalString(value: string | null | undefined) {
	if (!value) {
		return undefined;
	}

	return value;
}

export function useAnalyticsContext(options?: UseAnalyticsOptions) {
	const location = useLocation();
	const organization = useOptionalOrganization();
	const dateRange = useOptionalDateRange();
	const { data: session } = authClient.useSession();

	const userId =
		session?.user && "id" in session.user && typeof session.user.id === "string"
			? session.user.id
			: null;
	const pageName =
		options?.pageName ??
		(getAnalyticsPageName(location.pathname) as AppPageName | null);

	return {
		organizationId:
			options?.organizationId ?? organization?.state.activeOrg?.id ?? null,
		userId,
		pageName,
		dateRangeDays: dateRange?.meta.dayCount,
		pathname: location.pathname,
	};
}

export function useAnalyticsTracking(options?: UseAnalyticsOptions) {
	const analytics = useAnalyticsContext(options);

	function buildBasePayload(
		overrides?: AnalyticsOverrides,
	): AnalyticsPayload | null {
		if (!analytics.pageName) {
			return null;
		}

		return {
			page_name: analytics.pageName,
			organization_id:
				normalizeOptionalString(overrides?.organizationId) ??
				normalizeOptionalString(analytics.organizationId),
			user_id:
				normalizeOptionalString(overrides?.userId) ??
				normalizeOptionalString(analytics.userId),
			date_range_days: overrides?.dateRangeDays ?? analytics.dateRangeDays,
			source_component: overrides?.sourceComponent,
		};
	}

	function buildDashboardPayload(
		overrides?: AnalyticsOverrides,
	): DashboardAnalyticsPayload | null {
		const basePayload = buildBasePayload(overrides);

		if (!basePayload) {
			return null;
		}

		if (!isDashboardPageName(basePayload.page_name)) {
			return null;
		}

		if (!basePayload.organization_id || !basePayload.user_id) {
			return null;
		}

		return {
			...basePayload,
			page_name: basePayload.page_name,
			organization_id: basePayload.organization_id,
			user_id: basePayload.user_id,
		};
	}

	function trackFilterChange(
		input: {
			filterName: string;
			filterCategory: string;
			changeAction: string;
			sourceComponent: string;
			selectionCount?: number;
			valueKey?: string;
			affectedScope?: string;
		} & AnalyticsOverrides,
	) {
		const payload = buildDashboardPayload(input);

		if (!payload) {
			return;
		}

		captureDashboardFilterChanged({
			page_name: payload.page_name,
			date_range_days: payload.date_range_days,
			source_component: payload.source_component,
			filter_name: input.filterName,
			filter_category: input.filterCategory,
			change_action: input.changeAction,
			selection_count: input.selectionCount,
			value_key: input.valueKey,
			affected_scope: input.affectedScope,
		});
	}

	function trackDrilldown(
		input: {
			drilldownMethod: string;
			sourceComponent: string;
			targetType: string;
			targetPath?: string;
			targetId?: string;
			rank?: number;
		} & AnalyticsOverrides,
	) {
		const payload = buildDashboardPayload(input);

		if (!payload) {
			return;
		}

		captureDashboardDrilldownOpened({
			page_name: payload.page_name,
			date_range_days: payload.date_range_days,
			source_component: payload.source_component,
			drilldown_method: input.drilldownMethod,
			target_type: input.targetType,
			target_path: input.targetPath,
			target_id: input.targetId,
			rank: input.rank,
		});
	}

	function trackAuthenticationAction(
		input: {
			actionName: string;
			sourceComponent: string;
			authMethod?: string;
			entrypoint?: string;
			targetId?: string;
			result?: ProductAnalyticsActionResult;
			errorCode?: string;
			httpStatus?: number;
		} & AnalyticsOverrides,
	) {
		const payload = buildBasePayload(input);

		if (!payload) {
			return;
		}

		captureAuthenticationActionTriggered({
			...payload,
			action_name: input.actionName,
			auth_method: input.authMethod,
			entrypoint: input.entrypoint,
			target_id: input.targetId,
			result: input.result,
			error_code: input.errorCode,
			http_status: input.httpStatus,
		});
	}

	function trackOrganizationAction(
		input: {
			actionName: string;
			targetType: string;
			sourceComponent: string;
			targetId?: string;
			targetRole?: string;
			provider?: string;
			result?: ProductAnalyticsActionResult;
			errorCode?: string;
			httpStatus?: number;
		} & AnalyticsOverrides,
	) {
		const payload = buildBasePayload(input);

		if (!payload) {
			return;
		}

		captureOrganizationActionTriggered({
			...payload,
			action_name: input.actionName,
			target_type: input.targetType,
			target_id: input.targetId,
			target_role: input.targetRole,
			provider: input.provider,
			result: input.result,
			error_code: input.errorCode,
			http_status: input.httpStatus,
		});
	}

	return {
		...analytics,
		trackAuthenticationAction,
		trackDrilldown,
		trackFilterChange,
		trackOrganizationAction,
	};
}
