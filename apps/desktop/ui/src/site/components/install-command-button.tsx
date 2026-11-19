import { type ComponentProps, useId } from "react";
import "./install-command-button.css";

interface InstallCommandButtonProps extends ComponentProps<"button"> {
	command: string;
}

export function InstallCommandButton({
	command,
	className = "",
	...props
}: InstallCommandButtonProps) {
	const maskId = useId();
	return (
		<button
			className={`instant-v2-button instant-v2-button-primary ${className}`}
			type="button"
			data-instant-v2-copy
			data-instant-v2-copy-icon-button
			data-instant-v2-pointer-glow
			data-copy-feedback-ms="2000"
			{...props}
		>
			<span
				className="instant-v2-button-opalescence"
				data-instant-v2-pointer-glow-effect
				aria-hidden="true"
			/>
			<span className="instant-v2-button-glass" aria-hidden="true" />
			<span className="instant-v2-copy-content">
				<svg
					className="instant-v2-copy-icon"
					viewBox="0 0 24 24"
					fill="none"
					aria-hidden="true"
				>
					<rect
						className="instant-v2-copy-icon-lower"
						x="4.75"
						y="8.75"
						width="10.5"
						height="10.5"
						rx="2"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
					<g mask={`url(#${maskId})`}>
						<rect
							className="instant-v2-copy-icon-upper"
							x="8.75"
							y="4.75"
							width="10.5"
							height="10.5"
							rx="2"
							stroke="currentColor"
							strokeWidth="1.5"
						/>
					</g>
					<path
						className="instant-v2-copy-icon-check"
						d="M9.25 12.25L11 14.25L15 10"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						pathLength="1"
					/>
					<mask id={maskId} maskUnits="userSpaceOnUse">
						<rect width="24" height="24" fill="#fff" />
						<rect
							className="instant-v2-copy-icon-mask-shape"
							x="4.75"
							y="8.75"
							width="10.5"
							height="10.5"
							rx="2"
							fill="#000"
							stroke="#000"
							strokeWidth="1.5"
						/>
					</mask>
				</svg>
				<span className="instant-v2-copy-label">{command}</span>
			</span>
		</button>
	);
}
