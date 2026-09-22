import { createHash, randomUUID } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import {
	type BillingPricingState,
	findOpalineBillingOffer,
	findOpalineBillingOfferByPrice,
	OPALINE_BILLING_OFFERS,
	type OpalineBillingMode,
	type OpalineBillingOffer,
	type OpalineBillingPeriod,
	type OpalineBillingPlan,
	type OrganizationBillingSummary,
	PRODUCT_ANALYTICS_EVENTS,
	stripeObjectMatchesBillingMode,
} from "@rudel/api-routes";
import type postgres from "postgres";
import type Stripe from "stripe";
import { sqlClient } from "../db.js";
import { getFrontendOrigin } from "../frontend-origin.js";
import {
	getStripeClient,
	requireStripeBillingMode,
	STRIPE_API_VERSION,
} from "../stripe-client.js";
import {
	enqueueBillingAnalyticsEvent,
	enqueueBillingTraitsForOrganization,
	enqueueBillingTraitsForUsers,
} from "./billing-analytics-outbox.service.js";
import {
	buildBillingPricingOfferActions,
	stripeWebhookRetryDelayMs,
} from "./billing-domain.js";

interface CheckoutInput {
	billingPeriod: OpalineBillingPeriod;
	cancelUrl: string;
	organizationId: string;
	plan: OpalineBillingPlan;
	successUrl: string;
	userEmail: string;
	userId: string;
}

interface WebhookRow {
	attempt_count: number;
	event_id: string;
	status: "blocked" | "pending" | "processed";
}

export type StripeWebhookProcessingResult =
	| "blocked"
	| "processed"
	| "retrying";

type StoredSubscriptionStatus =
	| "active"
	| "canceled"
	| "incomplete"
	| "incomplete_expired"
	| "past_due"
	| "paused"
	| "trialing"
	| "unpaid";

interface StoredSubscription {
	billing_period: OpalineBillingPeriod;
	last_paid_amount: number | null;
	last_paid_at: Date | null;
	last_paid_currency: string | null;
	organization_id: string;
	pending_seat_expires_at: Date | null;
	pending_seat_quantity: number | null;
	plan: OpalineBillingPlan;
	purchaser_user_id: string | null;
	seat_quantity: number;
	status: StoredSubscriptionStatus;
	stripe_subscription_id: string;
}

interface SubscriptionCatalog {
	item: Stripe.SubscriptionItem;
	offer: OpalineBillingOffer;
	seatQuantity: number;
}

interface PendingSeatState {
	expiresAt: Date | null;
	quantity: number | null;
}

interface InvoiceCatalog {
	offer: OpalineBillingOffer;
	seatQuantity: number;
}

interface BillingPricingWorkspaceRow {
	billing_period: OpalineBillingPeriod | null;
	organization_id: string;
	plan: OpalineBillingPlan | null;
	role: string;
	status: StoredSubscriptionStatus | null;
	workspace_slug: string;
}

interface PlanChangeSubscription {
	billingPeriod: OpalineBillingPeriod;
	plan: OpalineBillingPlan;
	seatQuantity: number;
	status: StoredSubscriptionStatus;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
	stripeSubscriptionItemId: string;
}

interface CheckoutAttempt {
	billingPeriod: OpalineBillingPeriod;
	expiresAt: Date | null;
	id: string;
	organizationId: string;
	plan: OpalineBillingPlan;
	purchaserUserId: string;
	seatQuantity: number;
	status: "completed" | "creating" | "expired" | "open";
	stripeCheckoutSessionId: string | null;
	stripeCheckoutUrl: string | null;
	stripeCustomerId: string;
}

interface CheckoutAttemptRow {
	billing_period: OpalineBillingPeriod;
	expires_at: Date | string | null;
	id: string;
	organization_id: string;
	plan: OpalineBillingPlan;
	purchaser_user_id: string;
	seat_quantity: number;
	status: CheckoutAttempt["status"];
	stripe_checkout_session_id: string | null;
	stripe_checkout_url: string | null;
	stripe_customer_id: string;
}

interface CheckoutWorkspace {
	hasSubscription: boolean;
	hasLiveSubscription: boolean;
	seatCount: number;
}

interface ReservedCheckoutAttempt {
	attempt: CheckoutAttempt;
	currentSeatCount: number;
}

interface SeatReconciliationCandidate {
	desired_quantity: number;
	organization_id: string;
	seat_quantity: number;
	stripe_subscription_id: string;
	stripe_subscription_item_id: string;
	updated_at: Date | string;
}

type BillingSql = postgres.Sql | postgres.TransactionSql;

const MAX_WEBHOOK_ATTEMPTS = 36;
const BILLING_PORTAL_CONFIGURATION_VERSION = "5";
const billingLogger = getLogger(["rudel", "api", "billing"]);

export async function createOrganizationCheckoutSession(
	input: CheckoutInput,
): Promise<{
	billingMode: OpalineBillingMode;
	checkoutSessionId: string;
	checkoutUrl: string;
}> {
	assertBillingRedirectUrl(input.successUrl);
	assertBillingRedirectUrl(input.cancelUrl);
	const offer = findOpalineBillingOffer(input.plan, input.billingPeriod);
	if (!offer) throw new Error("Unsupported Opaline billing offer");
	const billingMode = requireStripeBillingMode();
	const stripe = requireStripeClient();
	const priceId = requireConfiguredPriceId(offer);
	const price = await stripe.prices.retrieve(priceId);
	assertConfiguredPriceMatchesOffer(price, offer, billingMode);
	const stripeCustomerId = await ensureOrganizationBillingCustomer(
		input,
		stripe,
		billingMode,
	);

	for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
		const reservation = await reserveOrganizationCheckoutAttempt(
			input,
			stripeCustomerId,
		);
		const { attempt } = reservation;
		const matchesSelection = checkoutAttemptMatchesInput(
			attempt,
			input,
			reservation.currentSeatCount,
			stripeCustomerId,
		);
		if (!matchesSelection && attempt.status === "creating") {
			throw new Error("Another checkout selection is being prepared; retry");
		}
		if (
			matchesSelection &&
			attempt.status === "open" &&
			attempt.stripeCheckoutSessionId &&
			attempt.stripeCheckoutUrl &&
			attempt.expiresAt &&
			attempt.expiresAt > new Date()
		) {
			await enqueueCheckoutStartedAnalytics(
				attempt,
				attempt.stripeCheckoutSessionId,
				billingMode,
			);
			return {
				billingMode,
				checkoutSessionId: attempt.stripeCheckoutSessionId,
				checkoutUrl: attempt.stripeCheckoutUrl,
			};
		}

		const session =
			attempt.status === "creating"
				? await materializeCheckoutAttempt(attempt, input, stripe, billingMode)
				: await readCheckoutAttemptSession(attempt, stripe);
		await storeCheckoutAttemptSession(attempt.id, session);

		if (!matchesSelection) {
			await retireCheckoutAttempt(attempt, session, stripe);
			continue;
		}
		if (session.status === "expired") continue;
		if (session.status === "complete") {
			throw new Error("Checkout completed and billing is still synchronizing");
		}
		if (!session.url) throw new Error("Stripe Checkout did not return a URL");
		await enqueueCheckoutStartedAnalytics(attempt, session.id, billingMode);
		return {
			billingMode,
			checkoutSessionId: session.id,
			checkoutUrl: session.url,
		};
	}
	throw new Error("Could not establish a current Stripe Checkout attempt");
}

async function ensureOrganizationBillingCustomer(
	input: CheckoutInput,
	stripe: Stripe,
	billingMode: OpalineBillingMode,
): Promise<string> {
	const stripeCustomerId = await sqlClient.begin(async (transaction) => {
		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(731827, hashtext($1))",
			[input.organizationId],
		);
		const [state] = await transaction.unsafe<
			Array<{
				mapped_customer_id: string | null;
				subscription_customer_id: string | null;
			}>
		>(
			`SELECT
				customer.stripe_customer_id AS mapped_customer_id,
				subscription.stripe_customer_id AS subscription_customer_id
			FROM organization
			LEFT JOIN billing_customer customer
				ON customer.organization_id = organization.id
			LEFT JOIN billing_subscription subscription
				ON subscription.organization_id = organization.id
			WHERE organization.id = $1`,
			[input.organizationId],
		);
		if (!state)
			throw new Error("Workspace billing customer state is unavailable");
		if (
			state.mapped_customer_id &&
			state.subscription_customer_id &&
			state.mapped_customer_id !== state.subscription_customer_id
		) {
			throw new Error("Workspace has conflicting Stripe customers");
		}
		const existingCustomerId =
			state.mapped_customer_id ?? state.subscription_customer_id;
		if (existingCustomerId) {
			await transaction.unsafe(
				`INSERT INTO billing_customer (organization_id, stripe_customer_id)
				VALUES ($1, $2)
				ON CONFLICT (organization_id) DO NOTHING`,
				[input.organizationId, existingCustomerId],
			);
			return existingCustomerId;
		}

		const customer = await stripe.customers.create(
			{
				metadata: {
					opaline_billing_mode: billingMode,
					opaline_organization_id: input.organizationId,
				},
			},
			{
				idempotencyKey: stripeIdempotencyKey("customer", input.organizationId),
			},
		);
		assertStripeObjectMode(customer.livemode, billingMode, "Customer");
		await transaction.unsafe(
			`INSERT INTO billing_customer (organization_id, stripe_customer_id)
			VALUES ($1, $2)`,
			[input.organizationId, customer.id],
		);
		return customer.id;
	});

	await stripe.customers.update(
		stripeCustomerId,
		{ email: input.userEmail },
		{
			idempotencyKey: stripeIdempotencyKey(
				"customer-email",
				`${stripeCustomerId}:${input.userEmail}`,
			),
		},
	);
	return stripeCustomerId;
}

async function reserveOrganizationCheckoutAttempt(
	input: CheckoutInput,
	stripeCustomerId: string,
): Promise<ReservedCheckoutAttempt> {
	return sqlClient.begin(async (transaction) => {
		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(731828, hashtext($1))",
			[input.organizationId],
		);
		const workspace = await readCheckoutWorkspace(
			input.organizationId,
			input.userId,
			transaction,
		);
		if (!workspace)
			throw new Error("Only the workspace owner can start checkout");
		if (workspace.hasLiveSubscription) {
			throw new Error("This workspace already has an active subscription");
		}

		const existing = await readCheckoutAttempt(
			input.organizationId,
			transaction,
		);
		if (
			existing?.status === "creating" ||
			(existing?.status === "open" &&
				(!existing.expiresAt || existing.expiresAt > new Date()))
		) {
			return { attempt: existing, currentSeatCount: workspace.seatCount };
		}
		if (existing?.status === "completed" && !workspace.hasSubscription) {
			throw new Error("Checkout completed and billing is still synchronizing");
		}

		const id = randomUUID();
		const [attempt] = await transaction.unsafe<CheckoutAttemptRow[]>(
			`INSERT INTO billing_checkout_attempt (
				id, organization_id, purchaser_user_id, stripe_customer_id,
				plan, billing_period, seat_quantity, status
			) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'creating')
			ON CONFLICT (organization_id) DO UPDATE SET
				id = EXCLUDED.id,
				purchaser_user_id = EXCLUDED.purchaser_user_id,
				stripe_customer_id = EXCLUDED.stripe_customer_id,
				stripe_checkout_session_id = NULL,
				stripe_checkout_url = NULL,
				plan = EXCLUDED.plan,
				billing_period = EXCLUDED.billing_period,
				seat_quantity = EXCLUDED.seat_quantity,
				status = 'creating',
				expires_at = NULL,
				created_at = NOW(),
				updated_at = NOW()
			RETURNING *`,
			[
				id,
				input.organizationId,
				input.userId,
				stripeCustomerId,
				input.plan,
				input.billingPeriod,
				workspace.seatCount,
			],
		);
		if (!attempt) throw new Error("Failed to reserve Stripe Checkout");
		return {
			attempt: mapCheckoutAttempt(attempt),
			currentSeatCount: workspace.seatCount,
		};
	});
}

async function materializeCheckoutAttempt(
	attempt: CheckoutAttempt,
	input: Pick<CheckoutInput, "cancelUrl" | "successUrl">,
	stripe: Stripe,
	billingMode: OpalineBillingMode,
): Promise<Stripe.Checkout.Session> {
	const offer = findOpalineBillingOffer(attempt.plan, attempt.billingPeriod);
	if (!offer) throw new Error("Checkout attempt uses an unsupported offer");
	const priceId = requireConfiguredPriceId(offer);
	const price = await stripe.prices.retrieve(priceId);
	assertConfiguredPriceMatchesOffer(price, offer, billingMode);
	const metadata = {
		opaline_billing_mode: billingMode,
		opaline_billing_period: offer.billingPeriod,
		opaline_checkout_attempt_id: attempt.id,
		opaline_organization_id: attempt.organizationId,
		opaline_plan: offer.plan,
		opaline_purchaser_user_id: attempt.purchaserUserId,
	};
	const session = await stripe.checkout.sessions.create(
		{
			allow_promotion_codes: false,
			cancel_url: input.cancelUrl,
			client_reference_id: attempt.organizationId,
			consent_collection: { terms_of_service: "required" },
			customer: attempt.stripeCustomerId,
			line_items: [{ price: priceId, quantity: attempt.seatQuantity }],
			metadata,
			mode: "subscription",
			payment_method_types: ["card"],
			subscription_data: { metadata },
			success_url: input.successUrl,
		},
		{ idempotencyKey: stripeIdempotencyKey("checkout", attempt.id) },
	);
	assertStripeObjectMode(session.livemode, billingMode, "Checkout Session");
	return session;
}

async function readCheckoutAttemptSession(
	attempt: CheckoutAttempt,
	stripe: Stripe,
): Promise<Stripe.Checkout.Session> {
	if (!attempt.stripeCheckoutSessionId) {
		throw new Error("Stripe Checkout attempt is missing its session");
	}
	return stripe.checkout.sessions.retrieve(attempt.stripeCheckoutSessionId);
}

async function storeCheckoutAttemptSession(
	attemptId: string,
	session: Stripe.Checkout.Session,
): Promise<void> {
	const status =
		session.status === "complete" ? "completed" : (session.status ?? "open");
	await sqlClient.unsafe(
		`UPDATE billing_checkout_attempt
		SET stripe_checkout_session_id = $2,
			stripe_checkout_url = $3,
			status = $4,
			expires_at = to_timestamp($5),
			updated_at = NOW()
		WHERE id = $1::uuid`,
		[attemptId, session.id, session.url, status, session.expires_at],
	);
}

async function retireCheckoutAttempt(
	attempt: CheckoutAttempt,
	session: Stripe.Checkout.Session,
	stripe: Stripe,
): Promise<void> {
	if (session.status === "complete") {
		throw new Error("Checkout completed and billing is still synchronizing");
	}
	if (session.status === "open") {
		const expired = await stripe.checkout.sessions.expire(
			session.id,
			{},
			{ idempotencyKey: stripeIdempotencyKey("checkout-expire", attempt.id) },
		);
		await storeCheckoutAttemptSession(attempt.id, expired);
		return;
	}
	await storeCheckoutAttemptSession(attempt.id, session);
}

async function enqueueCheckoutStartedAnalytics(
	attempt: CheckoutAttempt,
	checkoutSessionId: string,
	billingMode: OpalineBillingMode,
): Promise<void> {
	const offer = findOpalineBillingOffer(attempt.plan, attempt.billingPeriod);
	if (!offer) throw new Error("Checkout attempt uses an unsupported offer");
	await enqueueBillingAnalyticsEvent(
		{
			event: PRODUCT_ANALYTICS_EVENTS.PAYMENT_CHECKOUT_STARTED,
			properties: {
				billing_mode: billingMode,
				billing_period: offer.billingPeriod,
				catalog_recurring_amount: offer.unitAmount * attempt.seatQuantity,
				catalog_unit_amount: offer.unitAmount,
				checkout_session_id: checkoutSessionId,
				currency: offer.currency,
				organization_id: attempt.organizationId,
				payment_provider: "stripe",
				plan: offer.plan,
				seat_quantity: attempt.seatQuantity,
				user_id: attempt.purchaserUserId,
			},
		},
		{
			eventId: deterministicBillingEventId(attempt.id, "checkout-started"),
		},
	).catch(() => undefined);
}

function checkoutAttemptMatchesInput(
	attempt: CheckoutAttempt,
	input: CheckoutInput,
	currentSeatCount: number,
	stripeCustomerId: string,
): boolean {
	return (
		attempt.plan === input.plan &&
		attempt.billingPeriod === input.billingPeriod &&
		attempt.purchaserUserId === input.userId &&
		attempt.seatQuantity === currentSeatCount &&
		attempt.stripeCustomerId === stripeCustomerId
	);
}

export async function readOrganizationBillingSummary(
	organizationId: string,
): Promise<OrganizationBillingSummary> {
	const [subscription] = await sqlClient.unsafe<
		Array<{
			billing_period: OpalineBillingPeriod;
			plan: OpalineBillingPlan;
			seat_quantity: number;
			status: StoredSubscriptionStatus;
		}>
	>(
		`SELECT plan, billing_period, status, seat_quantity
		FROM billing_subscription
		WHERE organization_id = $1
		LIMIT 1`,
		[organizationId],
	);
	if (!subscription) return { hasBillingAccount: false };
	return {
		billingPeriod: subscription.billing_period,
		hasBillingAccount: true,
		plan: subscription.plan,
		seatQuantity: subscription.seat_quantity,
		status: subscription.status,
	};
}

export async function readBillingPricingState(input: {
	preferredOrganizationId: string | null;
	userId: string;
	workspaceSlug: string | undefined;
}): Promise<BillingPricingState> {
	const [workspace] = await sqlClient.unsafe<BillingPricingWorkspaceRow[]>(
		`SELECT
			o.id AS organization_id,
			o.slug AS workspace_slug,
			m.role,
			b.plan,
			b.billing_period,
			b.status
		FROM member m
		INNER JOIN organization o ON o.id = m.organization_id
		LEFT JOIN billing_subscription b ON b.organization_id = o.id
		WHERE m.user_id = $1
			AND ($2::text IS NULL OR o.slug = $2)
		ORDER BY (o.id = $3) DESC, m.created_at ASC, o.id ASC
		LIMIT 1`,
		[
			input.userId,
			input.workspaceSlug ?? null,
			input.preferredOrganizationId ?? "",
		],
	);
	if (!workspace) return { hasWorkspace: false };
	const canManageBilling = workspace.role === "owner";
	return {
		canManageBilling,
		hasWorkspace: true,
		offers: buildBillingPricingOfferActions({
			billingPeriod: workspace.billing_period,
			canManageBilling,
			plan: workspace.plan,
			status: workspace.status,
		}),
		organizationId: workspace.organization_id,
		status: workspace.status,
		workspaceSlug: workspace.workspace_slug,
	};
}

export async function createOrganizationPlanSelectionSession(
	input: CheckoutInput,
): Promise<
	| { redirectKind: "checkout"; redirectUrl: string }
	| { redirectKind: "portal"; redirectUrl: string }
> {
	const subscription = await readPlanChangeSubscription(input.organizationId);
	if (
		!subscription ||
		subscription.status === "canceled" ||
		subscription.status === "incomplete_expired"
	) {
		const checkout = await createOrganizationCheckoutSession(input);
		return { redirectKind: "checkout", redirectUrl: checkout.checkoutUrl };
	}
	if (subscription.status !== "active" && subscription.status !== "trialing") {
		throw new Error(
			"Resolve the existing subscription payment status before changing plans",
		);
	}
	if (
		subscription.plan === input.plan &&
		subscription.billingPeriod === input.billingPeriod
	) {
		throw new Error("This is already the workspace's current plan");
	}
	const portal = await createOrganizationPlanChangePortalSession(
		input,
		subscription,
	);
	return { redirectKind: "portal", redirectUrl: portal.portalUrl };
}

export async function createOrganizationBillingPortalSession(input: {
	organizationId: string;
	returnUrl: string;
}): Promise<{ billingMode: OpalineBillingMode; portalUrl: string }> {
	assertBillingRedirectUrl(input.returnUrl);
	const [subscription] = await sqlClient.unsafe<
		Array<{ stripe_customer_id: string }>
	>(
		`SELECT stripe_customer_id
		FROM billing_subscription
		WHERE organization_id = $1
		LIMIT 1`,
		[input.organizationId],
	);
	if (!subscription) {
		throw new Error("This workspace does not have a Stripe billing account");
	}

	const billingMode = requireStripeBillingMode();
	const stripe = requireStripeClient();
	const configurationId = await requireBillingPortalConfiguration(
		stripe,
		billingMode,
		input.returnUrl,
	);
	const session = await stripe.billingPortal.sessions.create({
		configuration: configurationId,
		customer: subscription.stripe_customer_id,
		return_url: input.returnUrl,
	});
	assertStripeObjectMode(
		session.livemode,
		billingMode,
		"billing portal session",
	);
	return { billingMode, portalUrl: session.url };
}

async function createOrganizationPlanChangePortalSession(
	input: CheckoutInput,
	subscription: PlanChangeSubscription,
): Promise<{ billingMode: OpalineBillingMode; portalUrl: string }> {
	assertBillingRedirectUrl(input.successUrl);
	const offer = findOpalineBillingOffer(input.plan, input.billingPeriod);
	if (!offer) throw new Error("Unsupported Opaline billing offer");
	const billingMode = requireStripeBillingMode();
	const stripe = requireStripeClient();
	const priceId = requireConfiguredPriceId(offer);
	const price = await stripe.prices.retrieve(priceId);
	assertConfiguredPriceMatchesOffer(price, offer, billingMode);
	const configurationId = await requireBillingPortalConfiguration(
		stripe,
		billingMode,
		input.successUrl,
	);
	const session = await stripe.billingPortal.sessions.create({
		configuration: configurationId,
		customer: subscription.stripeCustomerId,
		flow_data: {
			after_completion: {
				redirect: { return_url: input.successUrl },
				type: "redirect",
			},
			subscription_update_confirm: {
				items: [
					{
						id: subscription.stripeSubscriptionItemId,
						price: priceId,
						quantity: subscription.seatQuantity,
					},
				],
				subscription: subscription.stripeSubscriptionId,
			},
			type: "subscription_update_confirm",
		},
		return_url: input.cancelUrl,
	});
	assertStripeObjectMode(
		session.livemode,
		billingMode,
		"billing plan-change portal session",
	);
	await enqueueBillingAnalyticsEvent({
		event: PRODUCT_ANALYTICS_EVENTS.PAYMENT_PLAN_CHANGE_STARTED,
		properties: {
			billing_mode: billingMode,
			billing_period: offer.billingPeriod,
			catalog_recurring_amount: offer.unitAmount * subscription.seatQuantity,
			catalog_unit_amount: offer.unitAmount,
			currency: offer.currency,
			organization_id: input.organizationId,
			payment_provider: "stripe",
			plan: offer.plan,
			portal_session_id: session.id,
			seat_quantity: subscription.seatQuantity,
			user_id: input.userId,
		},
	}).catch(() => undefined);
	return { billingMode, portalUrl: session.url };
}

export async function enqueueStripeWebhookEvent(
	event: Stripe.Event,
): Promise<void> {
	assertStripeObjectMode(
		event.livemode,
		requireStripeBillingMode(),
		"webhook event",
	);
	if (event.api_version !== STRIPE_API_VERSION) {
		billingLogger.warn(
			"Stripe webhook API version differs from the application version (event={eventVersion}, application={applicationVersion})",
			{
				applicationVersion: STRIPE_API_VERSION,
				eventVersion: event.api_version ?? "none",
			},
		);
	}
	await sqlClient.unsafe(
		`INSERT INTO stripe_webhook_event (
			event_id, event_type, payload, event_created_at
		) VALUES ($1, $2, $3::jsonb, $4)
		ON CONFLICT (event_id) DO NOTHING`,
		[
			event.id,
			event.type,
			JSON.stringify(event),
			new Date(event.created * 1000).toISOString(),
		],
	);
}

export async function runStripeWebhookPass(limit = 20): Promise<number> {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new Error("Stripe webhook batch size must be between 1 and 100");
	}
	let processed = 0;
	for (let index = 0; index < limit; index += 1) {
		const found = await processNextWebhook();
		if (!found) break;
		processed += 1;
	}
	return processed;
}

export async function processStripeWebhookEvent(
	eventId: string,
): Promise<StripeWebhookProcessingResult> {
	return sqlClient.begin(async (transaction) => {
		const [row] = await transaction.unsafe<WebhookRow[]>(
			`SELECT event_id, attempt_count, status
			FROM stripe_webhook_event
			WHERE event_id = $1
			FOR UPDATE`,
			[eventId],
		);
		if (!row) {
			throw new Error(`Stripe webhook event ${eventId} is not queued`);
		}
		if (row.status !== "pending") return row.status;
		return processWebhookRow(row, transaction);
	});
}

export async function readBlockedStripeWebhookCount(): Promise<number> {
	const [row] = await sqlClient.unsafe<Array<{ count: number }>>(
		`SELECT COUNT(*)::int AS count
		FROM stripe_webhook_event
		WHERE status = 'blocked'`,
	);
	return row?.count ?? 0;
}

export async function readRetryingStripeWebhookCount(): Promise<number> {
	const [row] = await sqlClient.unsafe<Array<{ count: number }>>(
		`SELECT COUNT(*)::int AS count
		FROM stripe_webhook_event
		WHERE status = 'pending' AND attempt_count > 0`,
	);
	return row?.count ?? 0;
}

export async function readPendingSeatChargeCount(): Promise<number> {
	const [row] = await sqlClient.unsafe<Array<{ count: number }>>(
		`SELECT COUNT(*)::int AS count
		FROM billing_subscription
		WHERE pending_seat_quantity > seat_quantity`,
	);
	return row?.count ?? 0;
}

export async function requeueBlockedStripeWebhookEvent(
	eventId: string,
): Promise<boolean> {
	const rows = await sqlClient.unsafe<Array<{ event_id: string }>>(
		`UPDATE stripe_webhook_event
		SET status = 'pending', attempt_count = 0, next_attempt_at = NOW(),
			last_error = NULL, processed_at = NULL
		WHERE event_id = $1 AND status = 'blocked'
		RETURNING event_id`,
		[eventId],
	);
	return rows.length === 1;
}

export async function reconcileBillingSeats(limit = 5): Promise<number> {
	const candidates = await sqlClient.unsafe<SeatReconciliationCandidate[]>(
		`SELECT
			subscription.organization_id,
			subscription.stripe_subscription_id,
			subscription.stripe_subscription_item_id,
			subscription.seat_quantity,
			subscription.updated_at,
			GREATEST(COUNT(member.id)::int, 1) AS desired_quantity
		FROM billing_subscription subscription
		LEFT JOIN member ON member.organization_id = subscription.organization_id
		WHERE subscription.status IN ('active', 'trialing')
			AND (
				subscription.pending_seat_expires_at IS NULL
				OR subscription.pending_seat_expires_at <= NOW()
			)
		GROUP BY subscription.organization_id,
			subscription.stripe_subscription_id,
			subscription.stripe_subscription_item_id,
			subscription.seat_quantity,
			subscription.updated_at
		HAVING GREATEST(COUNT(member.id)::int, 1) <> subscription.seat_quantity
		ORDER BY subscription.updated_at
		LIMIT $1`,
		[limit],
	);
	if (candidates.length === 0) return 0;
	let reconciled = 0;
	for (const candidate of candidates) {
		if (await reconcileOrganizationBillingSeats(candidate.organization_id)) {
			reconciled += 1;
		}
	}
	return reconciled;
}

export async function reconcileOrganizationBillingSeats(
	organizationId: string,
): Promise<boolean> {
	return sqlClient.begin(async (transaction) => {
		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(731829, hashtext($1))",
			[organizationId],
		);
		const [candidate] = await transaction.unsafe<SeatReconciliationCandidate[]>(
			`SELECT
				subscription.organization_id,
				subscription.stripe_subscription_id,
				subscription.stripe_subscription_item_id,
				subscription.seat_quantity,
				subscription.updated_at,
				GREATEST((
					SELECT COUNT(*)::int FROM member
					WHERE organization_id = subscription.organization_id
				), 1) AS desired_quantity
			FROM billing_subscription subscription
			WHERE subscription.organization_id = $1
				AND subscription.status IN ('active', 'trialing')
				AND (
					subscription.pending_seat_expires_at IS NULL
					OR subscription.pending_seat_expires_at <= NOW()
				)
			FOR UPDATE`,
			[organizationId],
		);
		if (!candidate || candidate.desired_quantity === candidate.seat_quantity) {
			return false;
		}

		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(731826, hashtext($1))",
			[candidate.stripe_subscription_id],
		);
		const stripe = requireStripeClient();
		const current = await stripe.subscriptions.retrieve(
			candidate.stripe_subscription_id,
		);
		const catalog = resolveCatalogSubscription(current);
		if (current.pending_update) {
			await storeCanonicalSubscription(current, transaction);
			await enqueueBillingTraitsForOrganization(organizationId, transaction);
			return false;
		}
		if (current.status !== "active" && current.status !== "trialing") {
			await storeCanonicalSubscription(current, transaction);
			await enqueueBillingTraitsForOrganization(organizationId, transaction);
			return false;
		}
		if (catalog.seatQuantity === candidate.desired_quantity) {
			await storeCanonicalSubscription(current, transaction);
			await enqueueBillingTraitsForOrganization(organizationId, transaction);
			return true;
		}

		const updated = await stripe.subscriptions.update(
			current.id,
			{
				items: [
					{
						id: catalog.item.id,
						quantity: candidate.desired_quantity,
					},
				],
				payment_behavior: "pending_if_incomplete",
				proration_behavior:
					candidate.desired_quantity > catalog.seatQuantity
						? "always_invoice"
						: "create_prorations",
			},
			{
				idempotencyKey: stripeIdempotencyKey(
					"seat-reconciliation",
					`${current.id}:${catalog.item.id}:${catalog.seatQuantity}:${candidate.desired_quantity}:${new Date(candidate.updated_at).toISOString()}`,
				),
			},
		);
		await storeCanonicalSubscription(updated, transaction);
		await enqueueBillingTraitsForOrganization(organizationId, transaction);
		return true;
	});
}

export async function cancelOrganizationBillingSubscription(
	organizationId: string,
): Promise<void> {
	const [subscription] = await sqlClient.unsafe<
		Array<{ stripe_subscription_id: string; status: string }>
	>(
		`SELECT stripe_subscription_id, status
		FROM billing_subscription
		WHERE organization_id = $1`,
		[organizationId],
	);
	if (!subscription || isTerminalStatus(subscription.status)) return;
	const canceled = await requireStripeClient().subscriptions.cancel(
		subscription.stripe_subscription_id,
	);
	await sqlClient.begin(async (transaction) => {
		await storeCanonicalSubscription(canceled, transaction);
		await enqueueBillingTraitsForOrganization(organizationId, transaction);
	});
}

export async function enqueueBillingTraitsForUser(
	userId: string,
): Promise<void> {
	await enqueueBillingTraitsForUsers([userId]);
}

async function processNextWebhook(): Promise<boolean> {
	return sqlClient.begin(async (transaction) => {
		const [row] = await transaction.unsafe<WebhookRow[]>(
			`SELECT event_id, attempt_count, status
			FROM stripe_webhook_event
			WHERE status = 'pending' AND next_attempt_at <= NOW()
			ORDER BY event_created_at, event_id
			LIMIT 1
			FOR UPDATE SKIP LOCKED`,
		);
		if (!row) return false;
		await processWebhookRow(row, transaction);
		return true;
	});
}

async function processWebhookRow(
	row: WebhookRow,
	transaction: postgres.TransactionSql,
): Promise<StripeWebhookProcessingResult> {
	try {
		await transaction.savepoint(async (processingTransaction) => {
			const event = await requireStripeClient().events.retrieve(row.event_id);
			assertStripeObjectMode(
				event.livemode,
				requireStripeBillingMode(),
				"webhook event",
			);
			await processStripeEvent(event, processingTransaction);
			await processingTransaction.unsafe(
				`UPDATE stripe_webhook_event
				SET status = 'processed', processed_at = NOW(), payload = '{}'::jsonb,
					last_error = NULL
				WHERE event_id = $1`,
				[row.event_id],
			);
		});
		return "processed";
	} catch (error) {
		const attempts = row.attempt_count + 1;
		const blocked = attempts >= MAX_WEBHOOK_ATTEMPTS;
		const nextAttemptAt = new Date(
			Date.now() + stripeWebhookRetryDelayMs(attempts),
		);
		await transaction.unsafe(
			`UPDATE stripe_webhook_event
			SET status = $2, attempt_count = $3,
				next_attempt_at = $5,
				last_error = left($4, 1000)
			WHERE event_id = $1`,
			[
				row.event_id,
				blocked ? "blocked" : "pending",
				attempts,
				error instanceof Error ? error.message : String(error),
				nextAttemptAt.toISOString(),
			],
		);
		if (blocked) {
			billingLogger.error(
				"Stripe webhook permanently blocked after retries (event_id={eventId}, error={error})",
				{
					error: error instanceof Error ? error.message : String(error),
					eventId: row.event_id,
				},
			);
			return "blocked";
		}
		return "retrying";
	}
}

async function processStripeEvent(
	event: Stripe.Event,
	transaction: postgres.TransactionSql,
): Promise<void> {
	if (event.type === "customer.updated") {
		await syncCustomerDefaultPaymentMethod(event.data.object.id, transaction);
		return;
	}
	if (
		event.type === "checkout.session.completed" ||
		event.type === "checkout.session.async_payment_succeeded"
	) {
		await markCheckoutAttemptFromSession(
			event.data.object.id,
			"completed",
			transaction,
		);
		const subscriptionId = readExpandableId(event.data.object.subscription);
		if (subscriptionId) {
			await reconcileSubscription(subscriptionId, transaction);
		}
		return;
	}
	if (event.type === "checkout.session.expired") {
		await markCheckoutAttemptFromSession(
			event.data.object.id,
			"expired",
			transaction,
		);
		return;
	}
	if (
		event.type === "customer.subscription.created" ||
		event.type === "customer.subscription.updated" ||
		event.type === "customer.subscription.deleted" ||
		event.type === "customer.subscription.pending_update_applied" ||
		event.type === "customer.subscription.pending_update_expired"
	) {
		await reconcileSubscription(event.data.object.id, transaction);
		return;
	}
	if (event.type === "invoice.payment_succeeded") {
		await recordPaidInvoice(event.data.object, event, transaction, true);
		return;
	}
	if (event.type === "invoice.paid") {
		await recordPaidInvoice(event.data.object, event, transaction, false);
		return;
	}
	if (event.type === "invoice.finalization_failed") {
		const subscriptionId = readInvoiceSubscriptionId(event.data.object);
		if (subscriptionId) {
			await reconcileSubscription(subscriptionId, transaction);
		}
		billingLogger.error(
			"Stripe invoice finalization failed (invoice_id={invoiceId}, error={error})",
			{
				error: event.data.object.last_finalization_error?.message ?? "unknown",
				invoiceId: event.data.object.id,
			},
		);
		return;
	}
	if (
		event.type === "invoice.payment_failed" ||
		event.type === "invoice.payment_action_required"
	) {
		const subscriptionId = readInvoiceSubscriptionId(event.data.object);
		if (subscriptionId) {
			await reconcileSubscription(subscriptionId, transaction);
		}
	}
}

async function syncCustomerDefaultPaymentMethod(
	customerId: string,
	transaction: postgres.TransactionSql,
): Promise<void> {
	const stripe = requireStripeClient();
	const customer = await stripe.customers.retrieve(customerId);
	if (customer.deleted) return;
	const defaultPaymentMethodId = readExpandableId(
		customer.invoice_settings.default_payment_method,
	);
	if (!defaultPaymentMethodId) return;
	const subscriptions = await transaction.unsafe<
		Array<{ stripe_subscription_id: string }>
	>(
		`SELECT stripe_subscription_id
		FROM billing_subscription
		WHERE stripe_customer_id = $1
			AND status NOT IN ('canceled', 'incomplete_expired')
		FOR UPDATE`,
		[customerId],
	);
	for (const stored of subscriptions) {
		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(731826, hashtext($1))",
			[stored.stripe_subscription_id],
		);
		const current = await stripe.subscriptions.retrieve(
			stored.stripe_subscription_id,
		);
		if (
			current.status === "canceled" ||
			readExpandableId(current.default_payment_method) ===
				defaultPaymentMethodId
		) {
			await storeCanonicalSubscription(current, transaction);
			continue;
		}
		const updated = await stripe.subscriptions.update(
			current.id,
			{ default_payment_method: defaultPaymentMethodId },
			{
				idempotencyKey: stripeIdempotencyKey(
					"payment-method-recovery",
					`${current.id}:${defaultPaymentMethodId}`,
				),
			},
		);
		const canonical = await storeCanonicalSubscription(updated, transaction);
		await enqueueBillingTraitsForOrganization(
			canonical.organization_id,
			transaction,
		);
	}
}

async function markCheckoutAttemptFromSession(
	sessionId: string,
	status: "completed" | "expired",
	transaction: postgres.TransactionSql,
): Promise<void> {
	await transaction.unsafe(
		`UPDATE billing_checkout_attempt
		SET status = $2, updated_at = NOW()
		WHERE stripe_checkout_session_id = $1`,
		[sessionId, status],
	);
}

async function reconcileSubscription(
	subscriptionId: string,
	transaction: postgres.TransactionSql,
): Promise<StoredSubscription> {
	await transaction.unsafe(
		"SELECT pg_advisory_xact_lock(731826, hashtext($1))",
		[subscriptionId],
	);
	const subscription =
		await requireStripeClient().subscriptions.retrieve(subscriptionId);
	const stored = await storeCanonicalSubscription(subscription, transaction);
	await enqueueBillingTraitsForOrganization(
		stored.organization_id,
		transaction,
	);
	return stored;
}

async function recordPaidInvoice(
	invoice: Stripe.Invoice,
	event: Stripe.Event,
	transaction: postgres.TransactionSql,
	capturePayment: boolean,
): Promise<void> {
	const subscriptionId = readInvoiceSubscriptionId(invoice);
	if (!subscriptionId) return;
	const stored = await reconcileSubscription(subscriptionId, transaction);
	const paidAt = new Date(
		(invoice.status_transitions.paid_at ?? event.created) * 1000,
	);
	await transaction.unsafe(
		`UPDATE billing_subscription
		SET last_paid_amount = $2, last_paid_currency = $3,
			last_paid_at = $4, updated_at = NOW()
		WHERE stripe_subscription_id = $1
			AND (last_paid_at IS NULL OR last_paid_at <= $4)`,
		[
			subscriptionId,
			invoice.amount_paid,
			invoice.currency,
			paidAt.toISOString(),
		],
	);
	const amountPaidThroughStripe = Math.max(
		invoice.amount_paid - (invoice.amount_paid_off_stripe ?? 0),
		0,
	);
	if (
		capturePayment &&
		stored.purchaser_user_id &&
		amountPaidThroughStripe > 0
	) {
		const invoiceCatalog = resolveInvoiceCatalog(invoice, stored);
		const offer = invoiceCatalog.offer;
		await enqueueBillingAnalyticsEvent(
			{
				event: PRODUCT_ANALYTICS_EVENTS.PAYMENT_COMPLETED,
				properties: {
					amount_total: amountPaidThroughStripe,
					billing_mode: requireStripeBillingMode(),
					billing_period: offer.billingPeriod,
					catalog_recurring_amount:
						offer.unitAmount * invoiceCatalog.seatQuantity,
					catalog_unit_amount: offer.unitAmount,
					currency: invoice.currency,
					organization_id: stored.organization_id,
					payment_provider: "stripe",
					payment_status: "paid",
					plan: offer.plan,
					seat_quantity: invoiceCatalog.seatQuantity,
					stripe_invoice_id: invoice.id,
					subscription_status: stored.status,
					user_id: stored.purchaser_user_id,
				},
			},
			{
				eventId: deterministicBillingEventId(invoice.id, "payment-completed"),
				occurredAt: paidAt,
				transaction,
			},
		);
	}
	await enqueueBillingTraitsForOrganization(
		stored.organization_id,
		transaction,
	);
}

function resolveInvoiceCatalog(
	invoice: Stripe.Invoice,
	fallback: StoredSubscription,
): InvoiceCatalog {
	const configuredPrices = configuredStripePriceIds();
	const candidates = invoice.lines.data.flatMap((line) => {
		const priceId = readExpandableId(
			line.pricing?.price_details?.price ?? null,
		);
		if (!priceId) return [];
		const offer = OPALINE_BILLING_OFFERS.find(
			(item) => configuredPrices.get(item) === priceId,
		);
		const seatQuantity = line.quantity ?? 0;
		if (!offer || !Number.isSafeInteger(seatQuantity) || seatQuantity < 1) {
			return [];
		}
		return [{ amount: line.amount, offer, seatQuantity }];
	});
	const invoiced = candidates
		.filter((candidate) => candidate.amount > 0)
		.sort((left, right) => right.amount - left.amount)[0];
	if (invoiced) {
		return { offer: invoiced.offer, seatQuantity: invoiced.seatQuantity };
	}
	const offer = findOpalineBillingOffer(fallback.plan, fallback.billing_period);
	if (!offer) throw new Error("Stored subscription uses an unknown offer");
	return { offer, seatQuantity: fallback.seat_quantity };
}

function deterministicBillingEventId(
	providerEventId: string,
	eventKind: string,
): string {
	const digest = createHash("sha256")
		.update(`${providerEventId}:${eventKind}`, "utf8")
		.digest("hex");
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function stripeIdempotencyKey(operation: string, stableInput: string): string {
	const digest = createHash("sha256").update(stableInput, "utf8").digest("hex");
	return `opaline:${operation}:${digest}`;
}

async function storeCanonicalSubscription(
	subscription: Stripe.Subscription,
	transaction: postgres.TransactionSql,
): Promise<StoredSubscription> {
	const billingMode = requireStripeBillingMode();
	assertStripeObjectMode(subscription.livemode, billingMode, "subscription");
	if (
		readRequiredMetadata(subscription, "opaline_billing_mode") !== billingMode
	) {
		throw new Error("Stripe subscription metadata uses another billing mode");
	}
	const organizationId = readRequiredMetadata(
		subscription,
		"opaline_organization_id",
	);
	const purchaserUserId = readRequiredMetadata(
		subscription,
		"opaline_purchaser_user_id",
	);
	const catalog = resolveCatalogSubscription(subscription);
	const pendingSeat = resolvePendingSeatState(subscription, catalog.item.id);
	const [authorized] = await transaction.unsafe<Array<{ present: boolean }>>(
		`SELECT EXISTS (
			SELECT 1 FROM member
			WHERE organization_id = $1 AND user_id = $2 AND role = 'owner'
		) AS present`,
		[organizationId, purchaserUserId],
	);
	if (!authorized?.present) {
		throw new Error(
			"Stripe subscription metadata is not owned by the purchaser",
		);
	}
	const stripeCustomerId = readExpandableId(subscription.customer);
	if (!stripeCustomerId) throw new Error("Stripe subscription has no customer");
	await transaction.unsafe(
		`INSERT INTO billing_customer (organization_id, stripe_customer_id)
		VALUES ($1, $2)
		ON CONFLICT (organization_id) DO NOTHING`,
		[organizationId, stripeCustomerId],
	);
	const [billingCustomer] = await transaction.unsafe<
		Array<{ stripe_customer_id: string }>
	>(
		`SELECT stripe_customer_id
		FROM billing_customer
		WHERE organization_id = $1
		FOR UPDATE`,
		[organizationId],
	);
	if (billingCustomer?.stripe_customer_id !== stripeCustomerId) {
		throw new Error(
			"Workspace subscription uses a conflicting Stripe customer",
		);
	}

	const subscriptionStatus = readSubscriptionStatus(subscription.status);
	const [existingSubscription] = await transaction.unsafe<StoredSubscription[]>(
		`SELECT stripe_subscription_id, organization_id, purchaser_user_id,
			plan, billing_period, status, seat_quantity,
			pending_seat_quantity, pending_seat_expires_at, last_paid_amount,
			last_paid_currency, last_paid_at
		FROM billing_subscription
		WHERE organization_id = $1
		FOR UPDATE`,
		[organizationId],
	);
	if (
		existingSubscription &&
		existingSubscription.stripe_subscription_id !== subscription.id
	) {
		if (
			!isTerminalStatus(existingSubscription.status) &&
			!isTerminalStatus(subscriptionStatus)
		) {
			throw new Error("Workspace has multiple live Stripe subscriptions");
		}
		if (!isTerminalStatus(existingSubscription.status)) {
			return existingSubscription;
		}
		if (isTerminalStatus(subscriptionStatus)) return existingSubscription;
	}
	const [row] = await transaction.unsafe<StoredSubscription[]>(
		`INSERT INTO billing_subscription (
			stripe_subscription_id, organization_id, purchaser_user_id,
			stripe_customer_id, stripe_subscription_item_id, plan,
			billing_period, status, seat_quantity, pending_seat_quantity,
			pending_seat_expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (organization_id) DO UPDATE SET
			stripe_subscription_id = EXCLUDED.stripe_subscription_id,
			purchaser_user_id = EXCLUDED.purchaser_user_id,
			stripe_customer_id = EXCLUDED.stripe_customer_id,
			stripe_subscription_item_id = EXCLUDED.stripe_subscription_item_id,
			plan = EXCLUDED.plan,
			billing_period = EXCLUDED.billing_period,
			status = EXCLUDED.status,
			seat_quantity = EXCLUDED.seat_quantity,
			pending_seat_quantity = EXCLUDED.pending_seat_quantity,
			pending_seat_expires_at = EXCLUDED.pending_seat_expires_at,
			updated_at = NOW()
		RETURNING stripe_subscription_id, organization_id, purchaser_user_id,
			plan, billing_period, status, seat_quantity,
			pending_seat_quantity, pending_seat_expires_at, last_paid_amount,
			last_paid_currency, last_paid_at`,
		[
			subscription.id,
			organizationId,
			purchaserUserId,
			stripeCustomerId,
			catalog.item.id,
			catalog.offer.plan,
			catalog.offer.billingPeriod,
			subscriptionStatus,
			catalog.seatQuantity,
			pendingSeat.quantity,
			pendingSeat.expiresAt?.toISOString() ?? null,
		],
	);
	if (!row) throw new Error("Failed to store Stripe subscription");
	return row;
}

async function readCheckoutWorkspace(
	organizationId: string,
	userId: string,
	executor: BillingSql = sqlClient,
): Promise<CheckoutWorkspace | null> {
	const [row] = await executor.unsafe<
		Array<{
			has_subscription: boolean;
			has_live_subscription: boolean;
			seat_count: number;
		}>
	>(
		`SELECT
			GREATEST(COUNT(seat.id)::int, 1) AS seat_count,
			EXISTS (
				SELECT 1 FROM billing_subscription
				WHERE organization_id = $1
			) AS has_subscription,
			EXISTS (
				SELECT 1 FROM billing_subscription
				WHERE organization_id = $1
					AND status NOT IN ('canceled', 'incomplete_expired')
			) AS has_live_subscription
		FROM member owner
		LEFT JOIN member seat ON seat.organization_id = owner.organization_id
		WHERE owner.organization_id = $1 AND owner.user_id = $2
			AND owner.role = 'owner'
		GROUP BY owner.organization_id`,
		[organizationId, userId],
	);
	return row
		? {
				hasLiveSubscription: row.has_live_subscription,
				hasSubscription: row.has_subscription,
				seatCount: row.seat_count,
			}
		: null;
}

async function readCheckoutAttempt(
	organizationId: string,
	executor: BillingSql = sqlClient,
): Promise<CheckoutAttempt | null> {
	const [row] = await executor.unsafe<CheckoutAttemptRow[]>(
		`SELECT
			id, organization_id, purchaser_user_id, stripe_customer_id,
			stripe_checkout_session_id, stripe_checkout_url, plan,
			billing_period, seat_quantity, status, expires_at
		FROM billing_checkout_attempt
		WHERE organization_id = $1
		LIMIT 1`,
		[organizationId],
	);
	return row ? mapCheckoutAttempt(row) : null;
}

function mapCheckoutAttempt(row: CheckoutAttemptRow): CheckoutAttempt {
	return {
		billingPeriod: row.billing_period,
		expiresAt: row.expires_at ? new Date(row.expires_at) : null,
		id: row.id,
		organizationId: row.organization_id,
		plan: row.plan,
		purchaserUserId: row.purchaser_user_id,
		seatQuantity: row.seat_quantity,
		status: row.status,
		stripeCheckoutSessionId: row.stripe_checkout_session_id,
		stripeCheckoutUrl: row.stripe_checkout_url,
		stripeCustomerId: row.stripe_customer_id,
	};
}

async function readPlanChangeSubscription(
	organizationId: string,
): Promise<PlanChangeSubscription | null> {
	const [row] = await sqlClient.unsafe<
		Array<{
			billing_period: OpalineBillingPeriod;
			plan: OpalineBillingPlan;
			seat_quantity: number;
			status: StoredSubscriptionStatus;
			stripe_customer_id: string;
			stripe_subscription_id: string;
			stripe_subscription_item_id: string;
		}>
	>(
		`SELECT
			stripe_subscription_id,
			stripe_customer_id,
			stripe_subscription_item_id,
			plan,
			billing_period,
			seat_quantity,
			status
		FROM billing_subscription
		WHERE organization_id = $1
		LIMIT 1`,
		[organizationId],
	);
	return row
		? {
				billingPeriod: row.billing_period,
				plan: row.plan,
				seatQuantity: row.seat_quantity,
				status: row.status,
				stripeCustomerId: row.stripe_customer_id,
				stripeSubscriptionId: row.stripe_subscription_id,
				stripeSubscriptionItemId: row.stripe_subscription_item_id,
			}
		: null;
}

function resolveCatalogSubscription(
	subscription: Stripe.Subscription,
): SubscriptionCatalog {
	const recurringItems = subscription.items.data.filter(
		(item) => item.price.recurring !== null,
	);
	if (recurringItems.length !== 1) {
		throw new Error("Opaline subscriptions require exactly one recurring item");
	}
	const item = recurringItems[0];
	if (!item) throw new Error("Stripe subscription item is missing");
	const recurring = item.price.recurring;
	if (!recurring) throw new Error("Stripe subscription recurrence is missing");
	const offer = findOpalineBillingOfferByPrice(
		{
			billingScheme: item.price.billing_scheme,
			currency: item.price.currency,
			interval: recurring.interval,
			intervalCount: recurring.interval_count,
			priceId: item.price.id,
			unitAmount: item.price.unit_amount,
			usageType: recurring.usage_type,
		},
		configuredStripePriceIds(),
	);
	if (!offer) throw new Error("Stripe subscription uses an unsupported price");
	const seatQuantity = item.quantity ?? 0;
	if (!Number.isSafeInteger(seatQuantity) || seatQuantity < 1) {
		throw new Error("Stripe subscription has an invalid seat quantity");
	}
	return { item, offer, seatQuantity };
}

function resolvePendingSeatState(
	subscription: Stripe.Subscription,
	subscriptionItemId: string,
): PendingSeatState {
	const pendingUpdate = subscription.pending_update;
	if (!pendingUpdate) return { expiresAt: null, quantity: null };
	const pendingItem = pendingUpdate.subscription_items?.find(
		(item) => item.id === subscriptionItemId,
	);
	if (!pendingItem) return { expiresAt: null, quantity: null };
	const quantity = pendingItem.quantity ?? 0;
	if (!Number.isSafeInteger(quantity) || quantity < 1) {
		throw new Error(
			"Stripe pending subscription update has an invalid quantity",
		);
	}
	return {
		expiresAt: new Date(pendingUpdate.expires_at * 1000),
		quantity,
	};
}

function assertConfiguredPriceMatchesOffer(
	price: Stripe.Price,
	offer: OpalineBillingOffer,
	billingMode: OpalineBillingMode,
): void {
	assertStripeObjectMode(price.livemode, billingMode, "Price");
	const recurring = price.recurring;
	if (!price.active || !recurring)
		throw new Error("Stripe Price is not active");
	const resolved = findOpalineBillingOfferByPrice(
		{
			billingScheme: price.billing_scheme,
			currency: price.currency,
			interval: recurring.interval,
			intervalCount: recurring.interval_count,
			priceId: price.id,
			unitAmount: price.unit_amount,
			usageType: recurring.usage_type,
		},
		configuredStripePriceIds(),
	);
	if (resolved !== offer) {
		throw new Error(
			"Configured Stripe Price does not match the billing catalog",
		);
	}
}

function assertStripeObjectMode(
	liveMode: boolean,
	billingMode: OpalineBillingMode,
	objectName: string,
): void {
	if (!stripeObjectMatchesBillingMode(liveMode, billingMode)) {
		throw new Error(
			`${objectName} does not belong to the configured Stripe billing mode`,
		);
	}
}

function configuredStripePriceIds(): ReadonlyMap<OpalineBillingOffer, string> {
	const configured = new Map<OpalineBillingOffer, string>();
	for (const offer of OPALINE_BILLING_OFFERS) {
		const value = process.env[offer.stripePriceEnvironmentVariable]?.trim();
		if (value) configured.set(offer, value);
	}
	return configured;
}

function requireConfiguredPriceId(offer: OpalineBillingOffer): string {
	const value = process.env[offer.stripePriceEnvironmentVariable]?.trim();
	if (!value)
		throw new Error(`${offer.stripePriceEnvironmentVariable} is required`);
	return value;
}

function readRequiredMetadata(
	subscription: Stripe.Subscription,
	key: string,
): string {
	const value = subscription.metadata[key]?.trim();
	if (!value) throw new Error(`Stripe subscription metadata ${key} is missing`);
	return value;
}

function readInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
	return readExpandableId(
		invoice.parent?.subscription_details?.subscription ?? null,
	);
}

function readExpandableId(
	value: { id: string } | string | null,
): string | null {
	return typeof value === "string" ? value : (value?.id ?? null);
}

function requireStripeClient(): Stripe {
	const stripe = getStripeClient();
	if (!stripe) throw new Error("STRIPE_SECRET_KEY is required");
	return stripe;
}

async function requireBillingPortalConfiguration(
	stripe: Stripe,
	billingMode: OpalineBillingMode,
	returnUrl: string,
): Promise<string> {
	const products = await readBillingPortalProducts(stripe, billingMode);
	const configurations = await stripe.billingPortal.configurations.list({
		active: true,
		limit: 100,
	});
	const existing = configurations.data.find(
		(configuration) =>
			stripeObjectMatchesBillingMode(configuration.livemode, billingMode) &&
			configuration.metadata?.opaline_billing_mode === billingMode &&
			configuration.metadata?.opaline_configuration_version ===
				BILLING_PORTAL_CONFIGURATION_VERSION &&
			configuration.features.invoice_history.enabled &&
			configuration.features.payment_method_update.enabled &&
			configuration.features.subscription_cancel.enabled &&
			configuration.features.subscription_update.enabled &&
			configuration.features.subscription_update.proration_behavior ===
				"always_invoice",
	);
	if (existing) return existing.id;

	const configuration = await stripe.billingPortal.configurations.create({
		business_profile: {
			headline: "Manage your Opaline billing",
			privacy_policy_url: "https://opaline.so/legal/privacy-policy",
			terms_of_service_url: "https://opaline.so/legal/terms-of-service",
		},
		default_return_url: returnUrl,
		features: {
			customer_update: { enabled: false },
			invoice_history: { enabled: true },
			payment_method_update: { enabled: true },
			subscription_cancel: { enabled: true, mode: "at_period_end" },
			subscription_update: {
				billing_cycle_anchor: "unchanged",
				default_allowed_updates: ["price"],
				enabled: true,
				proration_behavior: "always_invoice",
				products,
			},
		},
		login_page: { enabled: false },
		metadata: {
			opaline_billing_mode: billingMode,
			opaline_configuration_version: BILLING_PORTAL_CONFIGURATION_VERSION,
		},
		name: `Opaline ${billingMode} payment management`,
	});
	assertStripeObjectMode(
		configuration.livemode,
		billingMode,
		"billing portal configuration",
	);
	return configuration.id;
}

async function readBillingPortalProducts(
	stripe: Stripe,
	billingMode: OpalineBillingMode,
): Promise<Array<{ prices: string[]; product: string }>> {
	const catalog = await Promise.all(
		OPALINE_BILLING_OFFERS.map(async (offer) => {
			const priceId = requireConfiguredPriceId(offer);
			const price = await stripe.prices.retrieve(priceId);
			assertConfiguredPriceMatchesOffer(price, offer, billingMode);
			const productId = readExpandableId(price.product);
			if (!productId) throw new Error(`Stripe Price ${priceId} has no Product`);
			return { priceId, productId };
		}),
	);
	const pricesByProduct = new Map<string, string[]>();
	for (const item of catalog) {
		const prices = pricesByProduct.get(item.productId) ?? [];
		prices.push(item.priceId);
		pricesByProduct.set(item.productId, prices);
	}
	return [...pricesByProduct].map(([product, prices]) => ({ prices, product }));
}

function assertBillingRedirectUrl(value: string): void {
	const url = new URL(value);
	const frontendOrigin = new URL(getFrontendOrigin()).origin;
	const local =
		url.protocol === "http:" &&
		(url.hostname === "localhost" || url.hostname === "127.0.0.1");
	if (url.protocol !== "https:" && !local) {
		throw new Error("Stripe billing redirects must use HTTPS");
	}
	if (url.origin !== frontendOrigin) {
		throw new Error("Stripe billing redirects must use the frontend origin");
	}
}

function isTerminalStatus(status: string): boolean {
	return status === "canceled" || status === "incomplete_expired";
}

function readSubscriptionStatus(
	status: Stripe.Subscription.Status,
): StoredSubscriptionStatus {
	if (status === "active") return "active";
	if (status === "canceled") return "canceled";
	if (status === "incomplete") return "incomplete";
	if (status === "incomplete_expired") return "incomplete_expired";
	if (status === "past_due") return "past_due";
	if (status === "paused") return "paused";
	if (status === "trialing") return "trialing";
	if (status === "unpaid") return "unpaid";
	throw new Error(`Unsupported Stripe subscription status: ${status}`);
}
