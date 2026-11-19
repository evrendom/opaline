import { type ReactNode, useId } from "react";
import "./workspace-settings.css";
import "../../components/settings-section.css";

/** A card: the section's title and description head the
 * card, its rows follow. */
export function WorkspaceSettingsGroup({
	title,
	description,
	tone = "default",
	action,
	children,
}: {
	title: string;
	description?: string;
	/** Danger zones title their card in the destructive color. */
	tone?: "default" | "danger";
	action?: ReactNode;
	children?: ReactNode;
}) {
	const titleId = useId();
	return (
		<section
			className="workspace-settings-group"
			aria-labelledby={titleId}
			data-tone={tone === "danger" ? "danger" : undefined}
		>
			<div className="workspace-settings-group-heading">
				<div className="workspace-settings-group-title">
					<h2 id={titleId}>{title}</h2>
					{description ? <p>{description}</p> : null}
				</div>
				{action ? (
					<div className="workspace-settings-group-action">{action}</div>
				) : null}
			</div>
			{children ? (
				<div className="workspace-settings-group-rows settings-section-surface">
					{children}
				</div>
			) : null}
		</section>
	);
}

export function WorkspaceSettingsRow({
	label,
	description,
	controlId,
	children,
}: {
	label: ReactNode;
	description?: ReactNode;
	controlId?: string;
	children: ReactNode;
}) {
	return (
		<div className="workspace-settings-row">
			<div className="workspace-settings-row-copy">
				{controlId ? (
					<label htmlFor={controlId}>{label}</label>
				) : (
					<div>{label}</div>
				)}
				{description ? (
					<div className="workspace-settings-row-description">
						{description}
					</div>
				) : null}
			</div>
			<div className="workspace-settings-row-control">{children}</div>
		</div>
	);
}

/** Fields: label over control, laid side by side and
 * bottom-aligned so a trailing button lines up with the inputs. */
export function WorkspaceSettingsFields({ children }: { children: ReactNode }) {
	return <div className="workspace-settings-fields">{children}</div>;
}

export function WorkspaceSettingsField({
	label,
	controlId,
	size = "fill",
	children,
}: {
	label: ReactNode;
	controlId?: string;
	/** `fill` shares the row; `compact` fits a short control like a role. */
	size?: "fill" | "compact";
	children: ReactNode;
}) {
	return (
		<div className="workspace-settings-field" data-size={size}>
			{controlId ? (
				<label htmlFor={controlId}>{label}</label>
			) : (
				<div>{label}</div>
			)}
			{children}
		</div>
	);
}
