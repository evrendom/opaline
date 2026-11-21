import { IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { mountStarCard } from "./star-card-controller";
import { useStarPrompt } from "./star-prompt";
import "./sidebar-star-card.css";

const TITLE = "Star us right here";
const BODY_OFF = "Your GitHub star, without leaving Opaline.";
const BODY_ON = "Thank you for starring!";
const HINT = "Drag the star all the way across.";

/**
 * Docked at the bottom of the rail after an hour of use: a split-flap star
 * count and a switch you drag all the way across to star Opaline. Starring
 * happens in the background, so nothing takes you out of the app.
 */
export function SidebarStarCard() {
	const prompt = useStarPrompt();
	const [closed, setClosed] = useState(false);
	if (!prompt || prompt.count === null || closed) return null;
	return (
		<StarCard
			count={prompt.count}
			onStar={prompt.star}
			onDismiss={prompt.dismiss}
			onClosed={() => setClosed(true)}
		/>
	);
}

function StarCard({
	count,
	onStar,
	onDismiss,
	onClosed,
}: {
	count: number;
	onStar: () => void;
	onDismiss: () => void;
	onClosed: () => void;
}) {
	const cardRef = useRef<HTMLElement>(null);
	const callbacks = useRef({ onStar, onDismiss, onClosed });
	callbacks.current = { onStar, onDismiss, onClosed };

	useEffect(() => {
		const card = cardRef.current;
		if (!card) return;
		const q = <T extends HTMLElement>(selector: string) =>
			card.querySelector(selector) as T;
		return mountStarCard(
			{
				card,
				wrap: q(".star-card-track-wrap"),
				track: q<HTMLButtonElement>(".star-card-track"),
				knob: q(".star-card-knob"),
				label: q(".star-card-label"),
				flaps: q(".star-card-flaps"),
				body: q(".star-card-body"),
				fx: q(".star-card-fx"),
				beams: [...card.querySelectorAll<HTMLElement>(".star-card-beam")],
				close: q<HTMLButtonElement>(".star-card-close"),
			},
			{
				count,
				bodyOff: BODY_OFF,
				bodyOn: BODY_ON,
				hint: HINT,
				onStar: () => callbacks.current.onStar(),
				onDismiss: () => callbacks.current.onDismiss(),
				onClosed: () => callbacks.current.onClosed(),
			},
		);
	}, [count]);

	return (
		<div className="star-card-dock">
			<section
				ref={cardRef}
				className="star-card rounded-[14px] squircle:rounded-[22px] corner-squircle"
				aria-label="Star Opaline"
			>
				<span className="star-card-beam is-glow" aria-hidden="true" />
				<span className="star-card-beam" aria-hidden="true" />
				<span className="star-card-fx" aria-hidden="true" />
				<button type="button" className="star-card-close" aria-label="Dismiss">
					<IconX className="size-3.5" stroke={2} />
				</button>
				<div className="star-card-flaps" aria-hidden="true" />
				<p className="star-card-title">{TITLE}</p>
				<p className="star-card-body" aria-live="polite" />
				<div className="star-card-track-wrap">
					<button
						type="button"
						className="star-card-track"
						role="switch"
						aria-checked="false"
						aria-label={`Star Opaline, ${count} stars. Drag across or press the right arrow.`}
					>
						<span className="star-card-label" aria-hidden="true">
							<span>Drag to star</span>
						</span>
						<span className="star-card-knob" />
					</button>
				</div>
			</section>
		</div>
	);
}
