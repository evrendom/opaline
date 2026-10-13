import type { db } from "../db.js";
import { readUnsubscribeToken } from "../services/usage-digest/unsubscribe-token.js";

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function page(title: string, body: string, status: number): Response {
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Opaline</title>
<style>body{margin:0;background:#f5f5f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171717}main{max-width:420px;margin:15vh auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:32px}h1{font-size:20px;margin:0 0 10px;letter-spacing:-0.02em}p{font-size:14px;line-height:1.6;color:#525252;margin:0}a{color:#171717}button{margin-top:20px;padding:10px 18px;border:0;border-radius:8px;background:#171717;color:#fff;font:600 14px inherit;cursor:pointer}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
		{
			status,
			headers: {
				"Cache-Control": "no-store",
				"Content-Type": "text/html; charset=utf-8",
			},
		},
	);
}

/**
 * The usage digest's unsubscribe link. GET, what a person opens from the
 * email footer, only asks to confirm: link scanners in mail gateways open
 * every link, and must not unsubscribe anyone. POST, from that page's button
 * or the mail client's List-Unsubscribe one-click request (RFC 8058), turns
 * the digest off. The signed token is the authorization; no session needed.
 */
export async function handleUsageDigestUnsubscribeRequest(
	request: Request,
	options: { secret: string; settingsUrl: string; database?: typeof db },
): Promise<Response> {
	if (request.method !== "GET" && request.method !== "POST")
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { Allow: "GET, POST" },
		});
	const token = new URL(request.url).searchParams.get("token") ?? "";
	const target = options.secret
		? readUnsubscribeToken(options.secret, token)
		: null;
	if (!target)
		return page(
			"This link is not valid",
			`<p>The unsubscribe link is incomplete or was changed. You can choose your emails in <a href="${escapeHtml(options.settingsUrl)}">your account settings</a>.</p>`,
			400,
		);
	if (request.method === "GET")
		return page(
			`Unsubscribe from the ${target.kind} digest?`,
			`<p>You will stop getting the ${target.kind} usage digest for this workspace. Other workspaces and emails stay as they are.</p><form method="post"><button type="submit">Unsubscribe</button></form>`,
			200,
		);
	const { setUsageDigestPreference } = await import(
		"../services/usage-digest/usage-digest.service.js"
	);
	const changed = await setUsageDigestPreference(
		{ ...target, enabled: false },
		options.database,
	);
	return changed
		? page(
				"You are unsubscribed",
				`<p>You will no longer get the ${target.kind} usage digest for this workspace. Changed your mind? <a href="${escapeHtml(options.settingsUrl)}">Turn it back on in settings</a>.</p>`,
				200,
			)
		: page(
				"Nothing to change",
				"<p>You are no longer a member of that workspace, so no digest is sent to you.</p>",
				200,
			);
}
