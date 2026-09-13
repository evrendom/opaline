import { type ReactNode, useId } from "react";
import "./workspace-settings.css";
import "../../components/settings-section.css";

export function WorkspaceSettingsGroup({
	title,
	description,
	hideTitle = false,
	children,
}: {
	title: string;
	description?: string;
	hideTitle?: boolean;
	children: ReactNode;
}) {
	const titleId = useId();
	return (
		<section className="workspace-settings-group" aria-labelledby={titleId}>
			<div
				className={hideTitle ? "sr-only" : "workspace-settings-group-heading"}
			>
				<h2 id={titleId}>{title}</h2>
				{description ? <p>{description}</p> : null}
			</div>
			<div className="workspace-settings-group-rows settings-section-surface">
				{children}
			</div>
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
