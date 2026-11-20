export const CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"base-uri 'self'",
	"connect-src 'self'",
	"font-src 'self' data:",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"frame-src 'self'",
	"img-src 'self' data: blob: https:",
	"media-src 'self' blob: https:",
	"object-src 'none'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"worker-src 'self' blob:",
].join("; ");

export const PRODUCTION_SECURITY_HEADERS = {
	"Content-Security-Policy": CONTENT_SECURITY_POLICY,
	"Permissions-Policy":
		"accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
} as const;

export function appendVaryHeader(headers: Headers, value: string): void {
	const values = (headers.get("Vary") ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
		values.push(value);
	}
	headers.set("Vary", values.join(", "));
}
