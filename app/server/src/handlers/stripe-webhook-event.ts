import type Stripe from "stripe";

export async function constructStripeWebhookEvent(input: {
	client: Stripe;
	payload: string;
	signature: string;
	webhookSecret: string;
}): Promise<Stripe.Event | null> {
	try {
		return await input.client.webhooks.constructEventAsync(
			input.payload,
			input.signature,
			input.webhookSecret,
		);
	} catch {
		return null;
	}
}

export async function readRequestTextWithinLimit(
	request: Request,
	limitBytes: number,
): Promise<string | null> {
	if (!request.body) {
		return "";
	}
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		totalBytes += value.byteLength;
		if (totalBytes > limitBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}
