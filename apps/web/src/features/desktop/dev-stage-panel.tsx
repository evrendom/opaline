import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CLI_SETUP_PATH } from "../cli-onboarding/cli-authorization";
import { useDesktop } from "./desktop-bridge";
import {
	DEV_STAGES,
	type DevStage,
	setDevStage,
	useDevStage,
} from "./dev-stages";
import "./dev-stage-panel.css";

export function DevStagePanel() {
	const desktop = useDesktop();
	const stage = useDevStage();
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const index = DEV_STAGES.findIndex((item) => item.id === stage);

	function pick(next: DevStage | null) {
		setDevStage(next);
		if (next && !pathname.endsWith(CLI_SETUP_PATH)) navigate(CLI_SETUP_PATH);
	}

	useEffect(() => {
		if (!desktop) return;
		function step(event: KeyboardEvent) {
			if (
				!event.altKey ||
				(event.key !== "ArrowRight" && event.key !== "ArrowLeft")
			)
				return;
			event.preventDefault();
			const next =
				event.key === "ArrowRight"
					? Math.min(DEV_STAGES.length - 1, index + 1)
					: Math.max(0, index - 1);
			const item = DEV_STAGES[next];
			if (!item) return;
			setDevStage(item.id);
			if (!pathname.endsWith(CLI_SETUP_PATH)) navigate(CLI_SETUP_PATH);
		}
		window.addEventListener("keydown", step);
		return () => window.removeEventListener("keydown", step);
	}, [desktop, index, pathname, navigate]);

	if (!import.meta.env.DEV || !desktop) return null;

	return (
		<div className="dev-stage-panel">
			{open && (
				<div className="dev-stage-list">
					<button
						type="button"
						aria-pressed={stage === null}
						onClick={() => pick(null)}
					>
						Live
					</button>
					{(["flow", "edge"] as const).map((group) => (
						<div key={group} className="dev-stage-group">
							<span>{group === "flow" ? "Flow" : "Edge cases"}</span>
							{DEV_STAGES.map((item, position) =>
								item.group === group ? (
									<button
										key={item.id}
										type="button"
										aria-pressed={stage === item.id}
										onClick={() => pick(item.id)}
									>
										<b>{position + 1}</b>
										{item.label}
									</button>
								) : null,
							)}
						</div>
					))}
					<small>⌥← ⌥→ to step</small>
				</div>
			)}
			<button
				type="button"
				className="dev-stage-toggle"
				onClick={() => setOpen((value) => !value)}
			>
				{index >= 0
					? `${index + 1} · ${DEV_STAGES[index]?.label}`
					: "Dev stages · Live"}
			</button>
		</div>
	);
}
