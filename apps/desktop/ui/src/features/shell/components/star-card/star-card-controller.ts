/**
 * The star card's motion, driven by hand on requestAnimationFrame so dragging
 * never re-renders React:
 *  - the knob follows the pointer (3px click threshold) and lands on its end
 *    on a critically damped spring;
 *  - past either end the track stretches and springs back exactly like the
 *    sessions range filter (slider-range-input.tsx);
 *  - the split-flap count follows the drag and glides on release;
 *  - a full drag stars: the star pops, sparkles burst, a border beam runs,
 *    and the card leaves with Sonner's toast motion.
 */

const KNOB = 28;
const INSET = 4;

const KNOB_SPRING = { k: 230, c: 26, m: 0.72 }; // c = 2·√(k·m): no overshoot
const BAND_SPRING = { k: 230, c: 8, m: 0.72 }; // the range filter's snap-back
const RUBBER = { deadZone: 8, cursorRange: 160, maxStretch: 18 };
const CLICK_THRESHOLD = 3;
const FLICK = 350;
const NUDGE_V = 1300;
const FLAP_GLIDE_MS = 220;
const LABEL_FADE = 0.45;
const SPARKLES = 18;
const SPARKLE_SPREAD = 66;
const CLOSE_AFTER_MS = 1900;
const HINT_MS = 1800;
// Sonner (2.0.7, bottom toaster): translateY(100%) + opacity 0 ⇄ rest, 400ms
// "ease"; a dismissed toast is removed 200ms into its exit.
const SONNER = { ms: 400, ease: "ease", unmountMs: 200 };

const STAR =
	"M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z";
const SPARKLE =
	"M12 0C12.9 7.2 16.8 11.1 24 12C16.8 12.9 12.9 16.8 12 24C11.1 16.8 7.2 12.9 0 12C7.2 11.1 11.1 7.2 12 0Z";

export type StarCardElements = {
	card: HTMLElement;
	wrap: HTMLElement;
	track: HTMLButtonElement;
	knob: HTMLElement;
	label: HTMLElement;
	flaps: HTMLElement;
	body: HTMLElement;
	fx: HTMLElement;
	beams: HTMLElement[];
	close: HTMLButtonElement;
};

export type StarCardOptions = {
	count: number;
	bodyOff: string;
	bodyOn: string;
	hint: string;
	onStar: () => void;
	onDismiss: () => void;
	onClosed: () => void;
};

type Spring = { k: number; c: number; m: number };
type Cell = {
	p: number;
	el: HTMLElement;
	top: HTMLElement;
	bot: HTMLElement;
	front: HTMLElement;
	back: HTMLElement;
	leaf: HTMLElement;
};
type Drag = {
	pid: number;
	x0: number;
	y0: number;
	rect: DOMRect;
	scale: number;
	click: boolean;
	offset: number;
	samples: [number, number][];
};

const reducedMotion = () =>
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The range filter's integrator (animateSpringValue), with a start velocity.
function springTo(
	from: number,
	to: number,
	v0: number,
	{ k, c, m }: Spring,
	onUpdate: (x: number) => void,
	onDone?: () => void,
) {
	let frame = 0;
	let last = performance.now();
	let x = from;
	let v = v0;
	let alive = true;
	const tick = (t: number) => {
		if (!alive) return;
		const dt = Math.max(0, Math.min((t - last) / 1000, 0.032));
		last = t;
		v += ((-k * (x - to) - c * v) / m) * dt;
		x += v * dt;
		if (Math.abs(x - to) < 0.01 && Math.abs(v) < 0.01) {
			alive = false;
			onUpdate(to);
			onDone?.();
			return;
		}
		onUpdate(x);
		frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);
	return () => {
		alive = false;
		cancelAnimationFrame(frame);
	};
}

// A digit only turns while every digit below it rolls 9 → 0.
function digitPosition(value: number, place: number) {
	const unit = 10 ** place;
	if (place === 0) return value % 10;
	return (
		(Math.floor(value / unit) % 10) +
		Math.min(1, Math.max(0, (value % unit) - (unit - 1)))
	);
}

function starSvg(filled: boolean, pop: boolean) {
	const cls = `${filled ? "star-card-star-on" : "star-card-star-off"}${pop ? " star-card-pop" : ""}`;
	return `<svg viewBox="0 0 24 24" class="${cls}" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${filled ? 0 : 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${STAR}"/></svg>`;
}

export function mountStarCard(
	el: StarCardElements,
	options: StarCardOptions,
): () => void {
	let on = false;
	let x = INSET;
	let stretch = 0;
	let flapF = 0;
	let pressed = false;
	let hovered = false;
	let dragging = false;
	let arrived = false;
	let full: boolean | undefined;
	let celebratePending = false;
	let drag: Drag | null = null;
	let stopSettle: (() => void) | null = null;
	let stopBand: (() => void) | null = null;
	let stopGlide: (() => void) | null = null;
	let cardAnimation: Animation | null = null;
	const timers = new Set<number>();
	const later = (fn: () => void, ms: number) => {
		const id = window.setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
		return id;
	};

	const baseW = () => el.wrap.offsetWidth;
	const minX = () => INSET;
	const maxX = () => baseW() - KNOB - INSET;
	const fracOf = (value: number) =>
		Math.min(1, Math.max(0, (value - minX()) / (maxX() - minX())));

	// ---- flaps ----
	const start = options.count;
	const digits = String(start + 1);
	el.flaps.innerHTML = "";
	const cells: Cell[] = [...digits].map((_, i) => {
		const p = digits.length - 1 - i;
		const cell = document.createElement("span");
		cell.className = `star-card-flap${p === 0 ? " is-ones" : ""}`;
		cell.innerHTML =
			'<span class="star-card-half is-top"><span></span></span><span class="star-card-half is-bot"><span></span></span><span class="star-card-leaf"><span class="is-front"><span></span></span><span class="is-back"><span></span></span></span>';
		el.flaps.append(cell);
		const q = (selector: string) => cell.querySelector(selector) as HTMLElement;
		return {
			p,
			el: cell,
			top: q(".is-top > span"),
			bot: q(".is-bot > span"),
			front: q(".is-front > span"),
			back: q(".is-back > span"),
			leaf: q(".star-card-leaf"),
		};
	});

	function paintFlaps() {
		const value = start + flapF;
		el.card.style.setProperty("--flap-frac", flapF.toFixed(4));
		for (const c of cells) {
			const pos = digitPosition(value, c.p);
			const cur = Math.floor(pos) % 10;
			const next = (cur + 1) % 10;
			const t = pos - Math.floor(pos);
			c.top.textContent = String(next);
			c.bot.textContent = String(cur);
			c.front.textContent = String(cur);
			c.back.textContent = String(next);
			c.leaf.style.transform = `rotateX(${-t * 180}deg)`;
			c.el.style.setProperty("--t", t.toFixed(4));
		}
	}

	// ---- one frame ----
	function paint() {
		const w = baseW() + Math.abs(stretch);
		el.track.style.width = `${w}px`;
		el.track.style.transform = `translateX(${stretch < 0 ? stretch : 0}px)`;
		const f = fracOf(x);
		el.knob.style.left = `${INSET + f * (w - KNOB - INSET * 2)}px`;
		el.track.style.setProperty("--frac", f.toFixed(4));
		el.label.style.opacity = Math.max(0, 1 - f / LABEL_FADE).toFixed(3);
		if (dragging) {
			stopGlide?.();
			flapF = f;
		}
		paintFlaps();
		if (!on) arrived = false;
		else if (f >= 0.985) arrived = true;
		const nowFull = dragging ? f >= 0.985 : on && arrived;
		if (nowFull !== full) {
			const first = full === undefined;
			full = nowFull;
			el.knob.innerHTML = starSvg(nowFull, !first && nowFull);
		}
		if (celebratePending && arrived && !dragging) {
			celebratePending = false;
			celebrate();
		}
		el.track.dataset.active = String(hovered || dragging);
		el.track.dataset.dragging = String(dragging);
		el.track.dataset.pressed = String(pressed);
	}

	// ---- springs ----
	function settle(target: boolean, v0 = 0) {
		stopSettle?.();
		stopSettle = springTo(
			x,
			target ? maxX() : minX(),
			v0,
			KNOB_SPRING,
			(next) => {
				x = next;
				paint();
			},
		);
	}
	function snapBand() {
		stopBand?.();
		if (!stretch) return;
		stopBand = springTo(stretch, 0, 0, BAND_SPRING, (next) => {
			stretch = Math.max(-RUBBER.maxStretch, Math.min(RUBBER.maxStretch, next));
			paint();
		});
	}
	function glideFlaps(to: number) {
		stopGlide?.();
		const from = flapF;
		const d = to - from;
		if (Math.abs(d) < 1e-4) return;
		const t0 = performance.now();
		const duration = FLAP_GLIDE_MS * Math.max(0.35, Math.abs(d));
		let frame = 0;
		let alive = true;
		const tick = (now: number) => {
			if (!alive) return;
			const u = Math.min(1, (now - t0) / duration);
			flapF = from + d * (1 - (1 - u) ** 3);
			paint();
			if (u < 1) frame = requestAnimationFrame(tick);
			else alive = false;
		};
		stopGlide = () => {
			alive = false;
			cancelAnimationFrame(frame);
		};
		frame = requestAnimationFrame(tick);
	}

	// ---- starring ----
	function commit(next: boolean, v0 = 0) {
		if (next && !on) {
			celebratePending = true;
			options.onStar();
		}
		on = next;
		el.track.setAttribute("aria-checked", String(on));
		el.body.textContent = on ? options.bodyOn : options.bodyOff;
		settle(on, v0);
		glideFlaps(on ? 1 : 0);
	}
	let hintTimer = 0;
	function nudge() {
		settle(on, (on ? -1 : 1) * NUDGE_V);
		if (on) return;
		el.body.textContent = options.hint;
		window.clearTimeout(hintTimer);
		hintTimer = later(() => {
			el.body.textContent = on ? options.bodyOn : options.bodyOff;
		}, HINT_MS);
	}

	// ---- celebration ----
	function burst(
		cx: number,
		cy: number,
		n: number,
		spread: number,
		up: boolean,
	) {
		const dark = document.documentElement.classList.contains("dark");
		for (let i = 0; i < n; i++) {
			const sparkle = document.createElement("span");
			const size = 8 + Math.random() * 9;
			const pick = Math.random();
			sparkle.className = "star-card-sparkle";
			sparkle.style.width = sparkle.style.height = `${size}px`;
			sparkle.style.color = dark
				? pick < 0.3
					? "#fff"
					: pick < 0.65
						? "var(--color-amber-300)"
						: "var(--color-amber-400)"
				: pick < 0.35
					? "var(--color-amber-400)"
					: pick < 0.75
						? "var(--color-amber-500)"
						: "var(--color-amber-600)";
			sparkle.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${SPARKLE}"/></svg>`;
			el.fx.append(sparkle);
			const angle =
				(up ? -Math.PI / 2 : 0) +
				(Math.random() - 0.5) * (up ? Math.PI * 1.5 : Math.PI * 2);
			const distance = spread * (0.45 + Math.random() * 0.75);
			const dx = Math.cos(angle) * distance;
			const dy = Math.sin(angle) * distance;
			const spin = (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 120);
			const at = (px: number, py: number, scale: number, rotate: number) =>
				`translate(${cx - size / 2 + px}px,${cy - size / 2 + py}px) scale(${scale}) rotate(${rotate}deg)`;
			sparkle.animate(
				[
					{ transform: at(0, 0, 0, 0), opacity: 1 },
					{
						transform: at(dx * 0.7, dy * 0.7, 1.15, spin * 0.5),
						opacity: 1,
						offset: 0.4,
					},
					{
						transform: at(dx * 0.92, dy * 0.92 + 4, 0.8, spin * 0.8),
						opacity: 0.9,
						offset: 0.72,
					},
					{ transform: at(dx, dy + 10, 0, spin), opacity: 0 },
				],
				{
					duration: 800 + Math.random() * 600,
					delay: Math.random() * 90,
					easing: "cubic-bezier(.2,.8,.3,1)",
					fill: "backwards",
				},
			).onfinish = () => sparkle.remove();
		}
	}
	function celebrate() {
		const box = el.card.getBoundingClientRect();
		const scale = box.width / el.card.offsetWidth || 1;
		const local = (r: DOMRect): [number, number] => [
			(r.left + r.width / 2 - box.left) / scale,
			(r.top + r.height / 2 - box.top) / scale,
		];
		if (!reducedMotion()) {
			const [kx, ky] = local(el.knob.getBoundingClientRect());
			burst(kx, ky, SPARKLES, SPARKLE_SPREAD, true);
			const ones = el.flaps.querySelector(".is-ones");
			if (ones)
				later(() => {
					const [ox, oy] = local(ones.getBoundingClientRect());
					burst(
						ox,
						oy,
						Math.round(SPARKLES * 0.45),
						SPARKLE_SPREAD * 0.6,
						false,
					);
				}, FLAP_GLIDE_MS * 0.6);
		}
		for (const beam of el.beams) {
			beam.classList.remove("is-running");
			void beam.offsetWidth;
			beam.classList.add("is-running");
		}
		later(() => leave(), CLOSE_AFTER_MS);
	}

	// ---- appear / leave (Sonner) ----
	function enter() {
		if (reducedMotion()) return;
		cardAnimation = el.card.animate(
			[
				{ transform: "translateY(100%)", opacity: 0 },
				{ transform: "translateY(0)", opacity: 1 },
			],
			{ duration: SONNER.ms, easing: SONNER.ease },
		);
	}
	let leaving = false;
	function leave() {
		if (leaving) return;
		leaving = true;
		cardAnimation?.cancel();
		if (reducedMotion()) {
			options.onClosed();
			return;
		}
		cardAnimation = el.card.animate(
			[
				{ transform: "translateY(0)", opacity: 1 },
				{ transform: "translateY(100%)", opacity: 0 },
			],
			{ duration: SONNER.ms, easing: SONNER.ease, fill: "forwards" },
		);
		later(() => options.onClosed(), SONNER.unmountMs);
	}

	// ---- pointer: the range filter's model ----
	const onEnter = () => {
		hovered = true;
		paint();
	};
	const onLeave = () => {
		hovered = false;
		paint();
	};
	const onDown = (event: PointerEvent) => {
		if (on) return;
		event.preventDefault();
		stopSettle?.();
		stopBand?.();
		const rect = el.wrap.getBoundingClientRect();
		const scale = rect.width / baseW() || 1;
		const grabbed = (event.clientX - rect.left) / scale;
		drag = {
			pid: event.pointerId,
			x0: event.clientX,
			y0: event.clientY,
			rect,
			scale,
			click: true,
			samples: [[performance.now(), event.clientX]],
			offset: grabbed >= x && grabbed <= x + KNOB ? grabbed - x : KNOB / 2,
		};
		el.track.setPointerCapture(event.pointerId);
		pressed = true;
		paint();
	};
	const onMove = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pid) return;
		event.preventDefault();
		if (
			drag.click &&
			Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) >
				CLICK_THRESHOLD
		) {
			drag.click = false;
			dragging = true;
		}
		if (drag.click) return;
		drag.samples.push([performance.now(), event.clientX]);
		if (drag.samples.length > 6) drag.samples.shift();
		x = Math.max(
			minX(),
			Math.min(
				maxX(),
				(event.clientX - drag.rect.left) / drag.scale - drag.offset,
			),
		);
		const left = event.clientX < drag.rect.left;
		const past = left
			? drag.rect.left - event.clientX
			: event.clientX > drag.rect.right
				? event.clientX - drag.rect.right
				: 0;
		stretch = past
			? (left ? -1 : 1) *
				RUBBER.maxStretch *
				Math.sqrt(
					Math.min(Math.max(0, past - RUBBER.deadZone) / RUBBER.cursorRange, 1),
				)
			: 0;
		paint();
	};
	const onUp = (event: PointerEvent, cancelled: boolean) => {
		if (!drag || event.pointerId !== drag.pid) return;
		const ended = drag;
		drag = null;
		if (el.track.hasPointerCapture(event.pointerId))
			el.track.releasePointerCapture(event.pointerId);
		pressed = false;
		dragging = false;
		snapBand();
		if (cancelled) {
			settle(on);
			glideFlaps(on ? 1 : 0);
			return;
		}
		if (ended.click) {
			nudge();
			paint();
			return;
		}
		const [t0, x0] = ended.samples[0];
		const [t1, x1] = ended.samples[ended.samples.length - 1];
		const v = t1 > t0 ? (x1 - x0) / ended.scale / ((t1 - t0) / 1000) : 0;
		commit(Math.abs(v) > FLICK ? v > 0 : fracOf(x) >= 0.5, v);
	};
	const onPointerUp = (event: PointerEvent) => onUp(event, false);
	const onPointerCancel = (event: PointerEvent) => onUp(event, true);
	const onClick = (event: MouseEvent) => event.preventDefault();
	// Keyboard stands in for the drag: arrows (Home/End) star; Space/Enter only nudge.
	const onKey = (event: KeyboardEvent) => {
		if (on) return;
		if (event.key === "ArrowRight" || event.key === "End") {
			event.preventDefault();
			commit(true);
		} else if (
			event.key === " " ||
			event.key === "Enter" ||
			event.key === "ArrowLeft" ||
			event.key === "Home"
		) {
			event.preventDefault();
			nudge();
		}
	};
	const onDismiss = () => {
		options.onDismiss();
		leave();
	};

	el.track.addEventListener("mouseenter", onEnter);
	el.track.addEventListener("mouseleave", onLeave);
	el.track.addEventListener("pointerdown", onDown);
	el.track.addEventListener("pointermove", onMove);
	el.track.addEventListener("pointerup", onPointerUp);
	el.track.addEventListener("pointercancel", onPointerCancel);
	el.track.addEventListener("click", onClick);
	el.track.addEventListener("keydown", onKey);
	el.close.addEventListener("click", onDismiss);

	el.body.textContent = options.bodyOff;
	x = minX();
	paint();
	enter();

	return () => {
		stopSettle?.();
		stopBand?.();
		stopGlide?.();
		cardAnimation?.cancel();
		for (const id of timers) window.clearTimeout(id);
		el.track.removeEventListener("mouseenter", onEnter);
		el.track.removeEventListener("mouseleave", onLeave);
		el.track.removeEventListener("pointerdown", onDown);
		el.track.removeEventListener("pointermove", onMove);
		el.track.removeEventListener("pointerup", onPointerUp);
		el.track.removeEventListener("pointercancel", onPointerCancel);
		el.track.removeEventListener("click", onClick);
		el.track.removeEventListener("keydown", onKey);
		el.close.removeEventListener("click", onDismiss);
	};
}
