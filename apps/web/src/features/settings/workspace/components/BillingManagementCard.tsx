import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, buttonVariants } from "@/app/ui/button";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { client, orpc } from "@/lib/orpc";

const PRICING_URL = "https://opaline.so/pricing";

export function BillingManagementCard({
	organizationId,
	workspaceSlug,
}: {
	organizationId: string;
	workspaceSlug: string;
}) {
	const summary = useQuery(
		orpc.billing.summary.queryOptions({ input: { organizationId } }),
	);
	const [isOpeningPortal, setIsOpeningPortal] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (summary.isPending) return null;
	if (summary.isError) {
		return (
			<WorkspaceSettingsGroup title="Billing">
				<div className="workspace-settings-actions">
					<p className="workspace-settings-error" role="alert">
						Billing information could not be loaded right now.
					</p>
				</div>
			</WorkspaceSettingsGroup>
		);
	}

	const currentPlan = summary.data?.hasBillingAccount
		? `${capitalize(summary.data.plan)} · ${capitalize(summary.data.billingPeriod)}`
		: "Free";
	const planLabel =
		summary.data?.hasBillingAccount &&
		(summary.data.status === "canceled" ||
			summary.data.status === "incomplete_expired")
			? "Previous plan"
			: "Current plan";
	const planDescription = summary.data?.hasBillingAccount
		? `${formatSeatCount(summary.data.seatQuantity)} · ${formatStatus(summary.data.status)}`
		: "Choose a paid plan on the pricing page.";
	const pricingUrl = new URL(PRICING_URL);
	pricingUrl.searchParams.set("workspace", workspaceSlug);

	return (
		<WorkspaceSettingsGroup title="Billing">
			<WorkspaceSettingsRow label={planLabel} description={planDescription}>
				<span className="workspace-settings-status">{currentPlan}</span>
			</WorkspaceSettingsRow>
			<WorkspaceSettingsRow
				label="Payment"
				description="Update your payment method, view invoices, or cancel in Stripe."
			>
				{summary.data?.hasBillingAccount ? (
					<Button
						type="button"
						variant="outline"
						disabled={isOpeningPortal}
						onClick={() =>
							void openBillingPortal({
								organizationId,
								setError,
								setIsOpeningPortal,
							})
						}
					>
						{isOpeningPortal ? "Opening…" : "Manage payment"}
					</Button>
				) : null}
				<a
					className={buttonVariants({ variant: "outline" })}
					href={pricingUrl.toString()}
				>
					Change plan
				</a>
			</WorkspaceSettingsRow>
			{error ? (
				<div className="workspace-settings-actions">
					<p className="workspace-settings-error" role="alert">
						{error}
					</p>
				</div>
			) : null}
		</WorkspaceSettingsGroup>
	);
}

async function openBillingPortal(input: {
	organizationId: string;
	setError: (value: string | null) => void;
	setIsOpeningPortal: (value: boolean) => void;
}): Promise<void> {
	input.setIsOpeningPortal(true);
	input.setError(null);
	try {
		const portal = await client.billing.createPortal({
			organizationId: input.organizationId,
		});
		window.location.assign(portal.portalUrl);
	} catch (portalError) {
		input.setError(
			portalError instanceof Error
				? portalError.message
				: "Could not open Stripe payment management.",
		);
		input.setIsOpeningPortal(false);
	}
}

function formatSeatCount(seatQuantity: number): string {
	return `${seatQuantity} ${seatQuantity === 1 ? "teammate" : "teammates"}`;
}

function formatStatus(status: string): string {
	return status.replaceAll("_", " ");
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
