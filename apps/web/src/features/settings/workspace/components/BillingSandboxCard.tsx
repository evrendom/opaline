import {
	OPALINE_BILLING_OFFERS,
	type OpalineBillingOffer,
} from "@rudel/api-routes";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/app/ui/button";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { client, orpc } from "@/lib/orpc";

export function BillingSandboxCard({
	organizationId,
}: {
	organizationId: string;
}) {
	const configuration = useQuery(orpc.billing.configuration.queryOptions({}));
	const summary = useQuery(
		orpc.billing.summary.queryOptions({ input: { organizationId } }),
	);
	const [activeOffer, setActiveOffer] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	if (
		configuration.isPending ||
		summary.isPending ||
		summary.isError ||
		configuration.data?.mode !== "sandbox" ||
		summary.data?.hasBillingAccount
	) {
		return null;
	}

	const configured = configuration.data.configured;

	return (
		<WorkspaceSettingsGroup
			title="Stripe sandbox"
			description="Test the real per-member subscription flow. Sandbox payments never move real money."
		>
			{OPALINE_BILLING_OFFERS.map((offer) => {
				const offerKey = `${offer.plan}:${offer.billingPeriod}`;
				const isLoading = activeOffer === offerKey;
				return (
					<WorkspaceSettingsRow
						key={offerKey}
						label={`${capitalize(offer.plan)} · ${capitalize(offer.billingPeriod)}`}
						description={formatOfferPrice(offer)}
					>
						<Button
							type="button"
							variant="outline"
							disabled={!configured || activeOffer !== null}
							onClick={() =>
								void startSandboxCheckout({
									activeOffer: offerKey,
									offer,
									organizationId,
									setActiveOffer,
									setError,
								})
							}
						>
							{isLoading ? "Opening…" : "Open test checkout"}
						</Button>
					</WorkspaceSettingsRow>
				);
			})}
			<WorkspaceSettingsRow
				label="Stripe test card"
				description="Use any future expiry date and any three-digit CVC."
			>
				<code>4242 4242 4242 4242</code>
			</WorkspaceSettingsRow>
			{!configured ? (
				<div className="workspace-settings-actions">
					<p className="workspace-settings-error" role="alert">
						Sandbox mode is selected, but its Stripe key, webhook secret, or
						four test Price IDs are missing.
					</p>
				</div>
			) : null}
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

async function startSandboxCheckout(input: {
	activeOffer: string;
	offer: OpalineBillingOffer;
	organizationId: string;
	setActiveOffer: (value: string | null) => void;
	setError: (value: string | null) => void;
}): Promise<void> {
	input.setActiveOffer(input.activeOffer);
	input.setError(null);
	try {
		const checkout = await client.billing.createCheckout({
			billingPeriod: input.offer.billingPeriod,
			organizationId: input.organizationId,
			plan: input.offer.plan,
		});
		if (checkout.billingMode !== "sandbox") {
			throw new Error("The server did not create a sandbox checkout");
		}
		window.location.assign(checkout.checkoutUrl);
	} catch (checkoutError) {
		input.setError(
			checkoutError instanceof Error
				? checkoutError.message
				: "Could not create the Stripe sandbox checkout.",
		);
		input.setActiveOffer(null);
	}
}

function formatOfferPrice(offer: OpalineBillingOffer): string {
	return offer.billingPeriod === "monthly"
		? `$${offer.monthlyPriceUsd} per teammate each month`
		: `$${offer.unitAmount / 100} per teammate each year`;
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
