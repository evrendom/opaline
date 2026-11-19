// Email lab: the usage digest emails rendered from fixtures, with a client
// simulator and Agentation to annotate them. The template is the one the API
// sends (packages/api-routes/src/usage-digest-email.ts), so edits hot-reload
// here.
//
//   bun run --cwd apps/desktop/ui dev:email-lab   → http://localhost:4011/email-lab.html

import {
	buildQuietWeekEmail,
	buildUsageDigestEmail,
	type EmailContent,
} from "@rudel/api-routes/usage-digest-email";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { LAB_VARIANTS, type LabVariant, labDigest } from "./fixtures";
import { LabAgentation } from "./lab-agentation";
import {
	type CanIEmailData,
	type EmailClient,
	type Finding,
	listClients,
	simulateClient,
} from "./simulate";

const WIDTHS = { desktop: 680, mobile: 390 } as const;
type Width = keyof typeof WIDTHS;
type View = "html" | "text";
const AS_SENT = "as-sent";

function render(variant: LabVariant): EmailContent {
	const assetOrigin = window.location.origin;
	if (variant === "quiet-week")
		return buildQuietWeekEmail({
			workspaceName: "Acme",
			periodLabel: "Oct 5 to Oct 11",
			setupUrl: "https://opaline.so/acme/settings/sessions",
			settingsUrl: "https://opaline.so/acme/settings/account#email-digests",
			unsubscribeUrl: "https://opaline.so/api/usage-digest/unsubscribe",
			assetOrigin,
		});
	return buildUsageDigestEmail(labDigest(variant, assetOrigin));
}

type Theme = "light" | "dark" | "inverted";

/**
 * The email's dark rules, as clients that apply its own dark styles (Apple
 * Mail, Outlook) use them: the prefers-color-scheme block of its <style>,
 * applied whatever this computer's own setting is.
 */
function darkRules(html: string): string {
	return (
		/@media \(prefers-color-scheme:dark\)\{([\s\S]*?\})\}/u.exec(html)?.[1] ??
		""
	);
}

/** The email's body, as a mail client shows it (head and body tags dropped). */
function bodyOf(html: string): string {
	return /<body[^>]*>([\s\S]*)<\/body>/u.exec(html)?.[1] ?? html;
}

const params = () => new URLSearchParams(window.location.search);

function readParam<T extends string>(
	name: string,
	allowed: readonly T[],
	fallback: T,
): T {
	const value = params().get(name);
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function EmailLab() {
	const [variant, setVariant] = useState<LabVariant>(() =>
		readParam(
			"variant",
			LAB_VARIANTS.map((item) => item.id),
			"weekly",
		),
	);
	const [width, setWidth] = useState<Width>(() =>
		readParam("width", ["desktop", "mobile"] as const, "desktop"),
	);
	const [view, setView] = useState<View>(() =>
		readParam("view", ["html", "text"] as const, "html"),
	);
	const [clientKey, setClientKey] = useState(
		() => params().get("client") ?? AS_SENT,
	);
	const [version, setVersion] = useState(() => params().get("version") ?? "");
	const [theme, setTheme] = useState<Theme>(() =>
		readParam("theme", ["light", "dark", "inverted"] as const, "light"),
	);
	const [data, setData] = useState<CanIEmailData | null>(null);
	const [dataError, setDataError] = useState<string | null>(null);

	useMountEffect(() => {
		fetch("/__email-lab/caniemail.json")
			.then((response) =>
				response.ok
					? (response.json() as Promise<CanIEmailData>)
					: Promise.reject(new Error(`HTTP ${response.status}`)),
			)
			.then(setData, (error: unknown) =>
				setDataError(
					`Client data unavailable (${String(error)}). Run the lab with \`bun run --cwd apps/desktop/ui dev:email-lab\`.`,
				),
			);
	});

	const clients = data ? listClients(data) : [];
	const client: EmailClient | undefined = clients.find(
		(candidate) => `${candidate.family}.${candidate.platform}` === clientKey,
	);
	const clientVersion =
		client && client.versions.includes(version)
			? version
			: (client?.versions.at(-1) ?? "");
	const email = render(variant);
	const simulated =
		data && client
			? simulateClient(bodyOf(email.html), data, client, clientVersion)
			: { html: bodyOf(email.html), findings: [] as Finding[] };

	function update(next: Record<string, string>) {
		const search = params();
		for (const [key, value] of Object.entries(next)) search.set(key, value);
		window.history.replaceState(null, "", `?${search}`);
	}

	return (
		<div style={styles.page}>
			<header style={styles.toolbar}>
				<div style={styles.row}>
					<strong style={{ fontSize: 13 }}>Email lab</strong>
					<Segmented
						value={variant}
						options={LAB_VARIANTS}
						onChange={(value) => {
							setVariant(value);
							update({ variant: value });
						}}
					/>
					<Segmented
						value={width}
						options={[
							{ id: "desktop", label: "Desktop" },
							{ id: "mobile", label: "Phone" },
						]}
						onChange={(value) => {
							setWidth(value);
							update({ width: value });
						}}
					/>
					<Segmented
						value={view}
						options={[
							{ id: "html", label: "HTML" },
							{ id: "text", label: "Plain text" },
						]}
						onChange={(value) => {
							setView(value);
							update({ view: value });
						}}
					/>
				</div>
				<div style={styles.row}>
					<label style={styles.field}>
						Client
						<select
							value={client ? clientKey : AS_SENT}
							onChange={(event) => {
								setClientKey(event.target.value);
								setVersion("");
								update({ client: event.target.value, version: "" });
							}}
							style={styles.select}
							disabled={!data}
						>
							<option value={AS_SENT}>As sent (no client rules)</option>
							{clients.map((option) => (
								<option
									key={`${option.family}.${option.platform}`}
									value={`${option.family}.${option.platform}`}
								>
									{option.label}
								</option>
							))}
						</select>
					</label>
					{client && client.versions.length > 1 ? (
						<label style={styles.field}>
							Version
							<select
								value={clientVersion}
								onChange={(event) => {
									setVersion(event.target.value);
									update({ version: event.target.value });
								}}
								style={styles.select}
							>
								{client.versions.map((option) => (
									<option key={option} value={option}>
										{option}
									</option>
								))}
							</select>
						</label>
					) : null}
					<Segmented
						value={theme}
						options={[
							{ id: "light", label: "Light" },
							{ id: "dark", label: "Dark (Apple Mail, Outlook)" },
							{ id: "inverted", label: "Dark (Gmail app inverts)" },
						]}
						onChange={(value) => {
							setTheme(value);
							update({ theme: value });
						}}
					/>
					<span style={{ fontSize: 12, color: "#737373" }}>
						{dataError ??
							(data
								? `caniemail.com data of ${data.last_update_date.slice(0, 10)}`
								: "Loading client data…")}
					</span>
				</div>
			</header>
			<main style={styles.main}>
				{theme === "dark" ? <style>{darkRules(email.html)}</style> : null}
				<div
					className={theme === "inverted" ? "email-lab-dark" : undefined}
					style={{
						...styles.inbox,
						width: WIDTHS[width],
						...(theme === "inverted" ? styles.dark : null),
						...(theme === "dark" ? { background: "#0a0a0a" } : null),
					}}
				>
					<div style={styles.subject}>
						<span style={{ color: "#737373" }}>Subject</span> {email.subject}
						<br />
						<span style={{ color: "#737373" }}>From</span> Opaline
						&lt;notifications@mail.opaline.so&gt;
					</div>
					{view === "html" ? (
						<div
							className="email-lab-body"
							// The email is a trusted local template rendered from fixtures.
							// biome-ignore lint/security/noDangerouslySetInnerHtml: email preview
							dangerouslySetInnerHTML={{ __html: simulated.html }}
						/>
					) : (
						<pre style={styles.text}>{email.text}</pre>
					)}
				</div>
				{client ? (
					<aside style={styles.findings}>
						<strong style={{ fontSize: 13 }}>
							{client.label} {clientVersion}
						</strong>
						<p style={styles.muted}>
							{simulated.findings.length
								? "Unsupported rules are removed from the preview; partly supported ones stay."
								: "Every rule this email uses is supported."}
						</p>
						{simulated.findings.map((finding) => (
							<div
								key={`${finding.slug}-${finding.support}`}
								style={styles.finding}
							>
								<div>
									<span
										style={{
											...styles.badge,
											...(finding.support === "unsupported" ||
											finding.support === "unsupported-here"
												? styles.badgeBad
												: styles.badgePartial),
										}}
									>
										{BADGES[finding.support]}
									</span>{" "}
									<a href={finding.url} target="_blank" rel="noreferrer">
										{finding.title}
									</a>{" "}
									<span style={styles.muted}>×{finding.count}</span>
								</div>
								{finding.notes.map((text) => (
									<p key={text} style={styles.note}>
										{text}
									</p>
								))}
							</div>
						))}
					</aside>
				) : null}
			</main>
			<Toaster position="bottom-left" />
			<LabAgentation
				context={[
					LAB_VARIANTS.find((item) => item.id === variant)?.label ?? variant,
					width === "mobile" ? "Phone" : "Desktop",
					theme === "light"
						? "Light"
						: theme === "dark"
							? "Dark (own styles)"
							: "Dark (inverted)",
					client ? `${client.label} ${clientVersion}` : "As sent",
				].join(" · ")}
			/>
		</div>
	);
}

function Segmented<T extends string>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: readonly { id: T; label: string }[];
	onChange: (value: T) => void;
}) {
	return (
		<div style={styles.segmented}>
			{options.map((option) => (
				<button
					key={option.id}
					type="button"
					onClick={() => onChange(option.id)}
					style={{
						...styles.segment,
						...(option.id === value ? styles.segmentActive : null),
					}}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

const BADGES: Record<Finding["support"], string> = {
	unsupported: "Removed",
	"unsupported-here": "Removed on some elements",
	rewritten: "Rewritten",
	partial: "Partial",
};

const styles = {
	page: {
		minHeight: "100vh",
		background: "#e4e4e7",
		fontFamily:
			"Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
		color: "#0a0a0a",
	},
	toolbar: {
		position: "sticky",
		top: 0,
		zIndex: 10,
		display: "flex",
		flexDirection: "column",
		gap: 8,
		padding: "10px 16px",
		background: "rgba(255,255,255,0.92)",
		backdropFilter: "blur(8px)",
		borderBottom: "1px solid #e5e5e5",
	},
	row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 },
	field: {
		display: "flex",
		alignItems: "center",
		gap: 6,
		fontSize: 12,
		color: "#404040",
	},
	select: {
		font: "inherit",
		fontSize: 12,
		padding: "4px 6px",
		borderRadius: 6,
		border: "1px solid #d4d4d4",
		background: "#fff",
	},
	segmented: {
		display: "flex",
		gap: 2,
		padding: 2,
		borderRadius: 8,
		background: "#f4f4f5",
	},
	segment: {
		border: 0,
		borderRadius: 6,
		padding: "5px 10px",
		background: "transparent",
		fontFamily: "inherit",
		fontSize: 12,
		fontWeight: 500,
		color: "#525252",
		cursor: "pointer",
	},
	segmentActive: {
		background: "#ffffff",
		color: "#0a0a0a",
		boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
	},
	main: {
		display: "flex",
		justifyContent: "center",
		alignItems: "flex-start",
		gap: 24,
		padding: "24px 16px 64px",
	},
	inbox: {
		flex: "none",
		background: "#f4f4f5",
		borderRadius: 12,
		overflow: "hidden",
		boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
	},
	dark: { filter: "invert(1) hue-rotate(180deg)" },
	subject: {
		padding: "12px 16px",
		background: "#ffffff",
		borderBottom: "1px solid #e5e5e5",
		fontSize: 13,
		lineHeight: "20px",
	},
	text: {
		margin: 0,
		padding: 24,
		background: "#ffffff",
		fontSize: 12,
		lineHeight: "18px",
		whiteSpace: "pre-wrap",
		fontFamily: "'SF Mono',Menlo,monospace",
	},
	findings: {
		position: "sticky",
		top: 104,
		width: 320,
		maxHeight: "calc(100vh - 128px)",
		overflowY: "auto",
		padding: 16,
		background: "#ffffff",
		borderRadius: 12,
		boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
		fontSize: 13,
	},
	muted: { color: "#737373", fontSize: 12, margin: "4px 0 12px" },
	finding: { padding: "10px 0", borderTop: "1px solid #f0f0f0" },
	note: {
		margin: "6px 0 0",
		fontSize: 12,
		lineHeight: "17px",
		color: "#525252",
	},
	badge: {
		display: "inline-block",
		padding: "1px 6px",
		borderRadius: 4,
		fontSize: 11,
		fontWeight: 600,
	},
	badgeBad: { background: "#fee2e2", color: "#991b1b" },
	badgePartial: { background: "#fef3c7", color: "#92400e" },
} satisfies Record<string, React.CSSProperties>;

const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<StrictMode>
			<EmailLab />
		</StrictMode>,
	);
