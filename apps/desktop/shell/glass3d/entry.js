import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import ICON_PATH from "./icon.js";
import digits from "./digits.js";

const FONT = new Font(digits);
const EM = 1;
const FOV = 28;
const DISTANCE = 10;

const BACKDROP_VERTEX = `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const BACKDROP_FRAGMENT = `
	uniform float uTime;
	uniform float uOpacity;
	uniform float uLight;
	uniform float uHand;
	uniform vec3 uPage;
	uniform float uLit;
	uniform float uLine;
	uniform float uWave;
	uniform float uPhase;
	uniform float uCurve;
	uniform float uDaysA[30];
	uniform float uDaysB[30];
	uniform float uDaysMix;
	uniform vec3 uTone;
	uniform float uToneMix;
	uniform float uSessions;
	uniform float uLift;
	uniform vec3 uTintA;
	uniform vec3 uTintB;
	uniform vec3 uTintC;
	uniform vec2 uTintDir;
	uniform float uTint;
	uniform sampler2D uField;
	uniform vec2 uFieldSize;
	uniform vec2 uSize;
	varying vec2 vUv;

	vec3 glimm(float t) {
		vec3 blue = vec3(0.180, 0.439, 1.0);
		vec3 indigo = vec3(0.482, 0.310, 1.0);
		vec3 purple = vec3(0.827, 0.235, 1.0);
		vec3 pink = vec3(1.0, 0.239, 0.753);
		t = 1.0 - abs(1.0 - 2.0 * fract(t));
		if (t < 0.333) return mix(blue, indigo, t / 0.333);
		if (t < 0.666) return mix(indigo, purple, (t - 0.333) / 0.333);
		return mix(purple, pink, (t - 0.666) / 0.334);
	}

	float dayAt(float x) {
		float u = clamp(x / (uSize.x * 0.8) + 0.5, 0.0, 1.0) * 29.0;
		float i = floor(u);
		float f = u - i;
		float a = 0.0;
		float b = 0.0;
		float c = 0.0;
		float e = 0.0;
		for (int k = 0; k < 30; k++) {
			float fk = float(k);
			float v = mix(uDaysA[k], uDaysB[k], uDaysMix);
			if (fk == max(i - 1.0, 0.0)) a = v;
			if (fk == i) b = v;
			if (fk == min(i + 1.0, 29.0)) c = v;
			if (fk == min(i + 2.0, 29.0)) e = v;
		}
		return b + 0.5 * f * (c - a + f * (2.0 * a - 5.0 * b + 4.0 * c - e + f * (3.0 * (b - c) + e - a)));
	}

	// An agent's three colors run along uTintDir across the glow behind the
	// tiles (about ±25% of the width and height), not the whole scene, so its
	// outer colors show too: (1, 0) is left to right, (1, 1) bottom left to
	// top right.
	vec3 tintAt(vec2 p) {
		vec2 q = p / (uSize * 0.25);
		float s = dot(q, uTintDir) / max(abs(uTintDir.x) + abs(uTintDir.y), 1e-4);
		float t = clamp(s * 0.5 + 0.5, 0.0, 1.0) * 2.0;
		return t < 1.0 ? mix(uTintA, uTintB, t) : mix(uTintB, uTintC, t - 1.0);
	}

	float crestAt(float x) {
		float w = uPhase;
		return mix(0.55 * sin(x * 0.42 + w * 0.22) + 0.32 * sin(x * 0.9 - w * 0.17 + 1.3) + 0.15, 0.75 - clamp(dayAt(x), 0.0, 1.0) * 1.5, uCurve) + uLift + uHand * uHand * uSize.y * 0.26;
	}

	void main() {
		vec2 p = (vUv - 0.5) * uSize;
		float t = uTime;
		float w = uPhase;
		float crest = crestAt(p.x);
		float d = -p.y - crest;
		vec2 spread = p / vec2(uSize.x * 0.42, uSize.y * 0.48);
		float falloff = exp(-dot(spread, spread) * 2.4);
		float body = mix(falloff, smoothstep(0.25, -0.35, d) * smoothstep(-3.2, -0.4, d) * falloff, uWave);
		float fringe = exp(-abs(d + 0.06) / 0.05) * falloff * uWave * (1.0 - smoothstep(0.55, 1.0, uHand));
		vec3 tint = tintAt(p);
		vec3 color = mix(vec3(0.0905), tint * 0.22, uTint) * body * (1.0 - uHand);
		vec3 lineTone = mix(mix(mix(vec3(0.5), glimm(p.x * 0.05 + t * 0.02), uLine), uTone, uToneMix), tint, uTint);
		float depth = max(d, 0.0);
		float water = smoothstep(-0.05, 0.25, d) * uWave;
		float under = water * falloff;
		vec2 ripple = vec2(
			sin(p.y * 5.0 + w * 1.4 + sin(p.x * 1.1 + w * 0.6) * 1.6),
			cos(p.x * 3.2 - w * 1.1 + p.y * 1.7)
		) * (0.02 + min(depth, 2.5) * 0.018) * water;
		vec2 q = p + ripple - vec2(0.0, uHand * uSize.y * 0.22);
		vec2 cell = floor(q / 0.16);
		vec2 grid = fract(q / 0.16) - 0.5;
		float radius = 0.12 + min(depth, 2.5) * 0.05 * water;
		float pip = smoothstep(radius, 0.04 * (1.0 - water), length(grid)) * pow(0.12 / radius, 1.5) * (1.0 - smoothstep(0.0, 0.75, uHand));
		float seed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) * 0.96;
		float lit = smoothstep(seed, seed + 0.04, uLit);
		float spark = lit - smoothstep(seed + 0.04, seed + 0.14, uLit);
		vec3 dotTone = mix(vec3(1.0), glimm(q.x * 0.05 + q.y * 0.04 + t * 0.08) * (5.0 + spark * 4.0), lit);
		if (uSessions > 0.001) {
			vec2 centre = (cell + 0.5) * 0.16;
			float row = floor((centre.y + crestAt(centre.x)) / 0.16);
			float col = floor((centre.x + uSize.x * 0.4) / 0.16);
			vec4 slot = vec4(0.0);
			if (row >= 0.0 && row < uFieldSize.y && col >= 0.0 && col < uFieldSize.x) slot = texture2D(uField, (vec2(col, row) + 0.5) / uFieldSize);
			vec3 sessionTone = slot.r > 0.5 ? mix(vec3(1.6), uTone * 9.0, slot.g) : vec3(0.3);
			dotTone = mix(dotTone, sessionTone, uSessions);
		}
		dotTone = mix(dotTone, mix(vec3(1.0), tintAt(q) * (5.0 + spark * 4.0), lit), uTint);
		vec3 tide = mix(vec3(1.0), vec3(0.62, 0.74, 1.0), water) * exp(-depth * 0.25 * water);
		color += vec3(0.0905) * under * 0.5;
		color += dotTone * tide * pip * (body * 0.9 + fringe * 0.6 + under * 0.6) * 0.22;
		color += lineTone * fringe * 0.42;
		if (uLight > 0.5) {
			float luma = dot(color, vec3(0.299, 0.587, 0.114));
			vec3 lifted = clamp(vec3(1.0 - luma * 0.7) + (color - luma), 0.0, 1.0) * uPage;
			gl_FragColor = vec4(mix(uPage, lifted, uOpacity), 1.0);
		} else {
			gl_FragColor = vec4(color * uOpacity, 1.0);
		}
	}
`;

const now = () => performance.now() / 1000;
const smooth = (x) => {
	const t = Math.min(1, Math.max(0, x));
	return t * t * (3 - 2 * t);
};
const SWEEP_S = 2.8;
const SWEEP_LIGHT_S = 1.8;
const SWEEP_Z = 2.6;
const KEY_INTENSITY = 1.6;
const SWEEP_DIM = 0.7;
const tick = (callback) => requestAnimationFrame(callback);
const untick = (id) => cancelAnimationFrame(id);

function mount(host, anchor, options = {}) {
	const intro = { appear: options.number ? 1 : 0, shown: null, badge: 0, badgeShown: null, lit: options.lit ? 1 : 0, curve: options.days ? 1 : 0, curving: null, last: null, born: null, finish: options.lit ? { start: -10, from: 1 } : null };
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.setClearColor(0x000000, 1);
	const canvas = renderer.domElement;
	canvas.className = "glass-canvas";
	host.append(canvas);

	const scene = new THREE.Scene();
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	scene.environmentIntensity = 0.07;

	const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
	camera.position.set(0, 0, DISTANCE);

	const backdrop = new THREE.Mesh(
		new THREE.PlaneGeometry(1, 1),
		new THREE.ShaderMaterial({
			vertexShader: BACKDROP_VERTEX,
			fragmentShader: BACKDROP_FRAGMENT,
			uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uLight: { value: 0 }, uHand: { value: 0 }, uPage: { value: new THREE.Color(0xfcfcfc) }, uLit: { value: options.lit ? 1 : 0 }, uLine: { value: options.lit ? 1 : 0 }, uWave: { value: 1 }, uPhase: { value: 0 }, uCurve: { value: options.days ? 1 : 0 }, uDaysA: { value: options.days ? [...options.days] : new Array(30).fill(0) }, uDaysB: { value: options.days ? [...options.days] : new Array(30).fill(0) }, uDaysMix: { value: 0 }, uTone: { value: new THREE.Color(1, 1, 1) }, uToneMix: { value: 0 }, uSessions: { value: 0 }, uLift: { value: 0 }, uTintA: { value: new THREE.Color() }, uTintB: { value: new THREE.Color() }, uTintC: { value: new THREE.Color() }, uTintDir: { value: new THREE.Vector2(1, 0) }, uTint: { value: 0 }, uField: { value: null }, uFieldSize: { value: new THREE.Vector2(1, 1) }, uSize: { value: new THREE.Vector2(1, 1) } },
			depthWrite: false,
		}),
	);
	backdrop.position.z = -6;
	scene.add(backdrop);

	const key = new THREE.PointLight(0xffffff, KEY_INTENSITY, 0, 0);
	key.position.set(-3, 4, 6);
	scene.add(key);
	const fill = new THREE.DirectionalLight(0x8fa2ff, 0.6);
	fill.position.set(4, -2, 3);
	scene.add(fill);

	const glass = new THREE.MeshPhysicalMaterial({
		color: 0x55585e,
		metalness: 1,
		roughness: 0.3,
		clearcoat: 0.12,
		clearcoatRoughness: 0.12,
		transparent: true,
	});
	const flat = new THREE.Color(0xe6e6e9);
	const dark = new THREE.Color(0x55585e);
	let lightMode = Boolean(options.light);
	const lightPoint = () => {
		const point = key.position.clone().project(camera);
		const box = host.getBoundingClientRect();
		return { x: box.left + ((point.x + 1) / 2) * box.width, y: box.top + ((1 - point.y) / 2) * box.height };
	};
	const report = (light, glint = 0) => options.onLight?.(light, glint, lightPoint());
	const theme = (light) => {
		lightMode = light;
		if (light && !intro.lighting && intro.light === 0) {
			intro.badge = 0;
			report(1);
		}
		backdrop.material.uniforms.uLight.value = light ? 1 : 0;
		renderer.setClearColor(light ? 0xfcfcfc : 0x000000, 1);
		flat.set(light ? 0x292a2f : 0xe6e6e9);
		dark.set(light ? 0xc9ccd2 : 0x55585e);
		scene.environmentIntensity = light ? 0.45 : 0.07;
		badgeGlass?.color.copy(dark);
	};

	const glyphs = new Map();
	const geometryFor = (char) => {
		if (!glyphs.has(char)) {
			const geometry = new TextGeometry(char, { font: FONT, size: 1, depth: 0.2, curveSegments: 14, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.016, bevelSegments: 8 });
			geometry.computeVertexNormals();
			glyphs.set(char, geometry);
		}
		return glyphs.get(char);
	};
	const advance = (char) => ((FONT.data.glyphs[char]?.ha ?? 600) / FONT.data.resolution) * EM;
	const zero = geometryFor("0");
	zero.computeBoundingBox();
	const CAP = zero.boundingBox.max.y;
	const DIGITS = "0123456789";
	const TRACKING = -0.05 * (100000 / 72 / FONT.data.resolution) * EM;
	const TABULAR = Math.max(...[...DIGITS].map(advance)) + TRACKING;

	const ICON_HEIGHT = CAP * 0.8;
	const badgeGlass = glass.clone();
	const badge = new THREE.Group();
	{
		const parsed = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 347"><path fill-rule="evenodd" d="${ICON_PATH}"/></svg>`);
		const unit = ICON_HEIGHT / 347;
		const geometry = new THREE.ExtrudeGeometry(SVGLoader.createShapes(parsed.paths[0]), { depth: 0.2 / unit, curveSegments: 32, bevelEnabled: true, bevelThickness: 0.035 / unit, bevelSize: 0.016 / unit, bevelSegments: 8 });
		geometry.scale(unit, unit, unit);
		geometry.rotateX(Math.PI);
		geometry.center();
		geometry.computeVertexNormals();
		badge.add(new THREE.Mesh(geometry, badgeGlass));
		scene.add(badge);
	}
	const keyRest = key.position.clone();
	const keyLit = new THREE.Vector3(-keyRest.x, keyRest.y, keyRest.z);
	const restKey = () => {
		if (key.position.equals(keyRest)) return;
		const from = key.position.clone();
		tween("key", 0, 1, 1.4, (value) => {
			key.position.lerpVectors(from, keyRest, value);
			report(1);
		});
	};
	intro.light = 0;
	if (options.badge && !lightMode && !options.lit) intro.badge = 1;
	report(intro.badge && !options.lit ? 0 : 1);
	const animateBadge = (on, sweep = false) => {
		intro.badgeShown?.done();
		intro.badgeShown = null;
		intro.lighting?.done();
		intro.lighting = null;
		key.intensity = KEY_INTENSITY;
		if (!sweep) restKey();
		if (!sweep || !on || lightMode) {
			if (on) intro.light = 1;
			return new Promise((done) => {
				intro.badgeShown = { from: intro.badge, to: on ? 1 : 0, start: now(), done };
			});
		}
		intro.badge = 1;
		return new Promise((done) => {
			intro.lighting = { start: now(), done };
		});
	};
	if (options.badge && options.lit) animateBadge(true);
	theme(Boolean(options.light));

	const word = new THREE.Group();
	const tilt = new THREE.Group();
	tilt.add(word);
	scene.add(tilt);
	let width = 0;
	let shown = "";

	function set(text) {
		if (text === shown) return;
		shown = text;
		word.clear();
		let x = 0;
		for (const char of text) {
			const glyph = FONT.data.glyphs[char];
			const digit = DIGITS.includes(char);
			const cell = digit ? TABULAR : advance(char);
			if (glyph) {
				const mesh = new THREE.Mesh(geometryFor(char), glass);
				const inked = ((glyph.x_max - glyph.x_min) / FONT.data.resolution) * EM;
				mesh.position.x = digit ? x + (cell - inked) / 2 - (glyph.x_min / FONT.data.resolution) * EM : x;
				word.add(mesh);
			}
			x += cell;
		}
		width = x;
		word.position.x = -width / 2;
		word.position.y = -CAP / 2;
		word.position.z = -0.1;
	}

	const pixelsPerUnit = () => canvas.clientHeight / (2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));

	const view = { scale: 1, x: 0, y: 0, badge: 1 };
	function fit() {
		const box = host.getBoundingClientRect();
		const spot = anchor.getBoundingClientRect();
		if (canvas.width !== Math.round(box.width * renderer.getPixelRatio()) || canvas.height !== Math.round(box.height * renderer.getPixelRatio())) renderer.setSize(box.width, box.height, false);
		camera.aspect = box.width / Math.max(1, box.height);
		camera.updateProjectionMatrix();
		const ppu = pixelsPerUnit();
		const unitsHigh = (2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (DISTANCE + 6)) / DISTANCE;
		backdrop.scale.set(unitsHigh * camera.aspect, unitsHigh, 1);
		backdrop.material.uniforms.uSize.value.set(unitsHigh * camera.aspect, unitsHigh);
		if (field?.perDay) buildField();
		const capPixels = spot.height * 0.62;
		const widthPixels = width * (capPixels / CAP);
		const fitted = Math.min(capPixels, (spot.width * 0.92 * capPixels) / Math.max(1, widthPixels));
		view.scale = fitted / CAP / ppu;
		view.badge = capPixels / CAP / ppu;
		view.x = (spot.left + spot.width / 2 - (box.left + box.width / 2)) / ppu;
		view.y = -(spot.top + spot.height / 2 - (box.top + box.height / 2)) / ppu;
	}

	const lean = { target: { x: 0, y: 0 }, value: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
	const follow = (event) => {
		const box = host.getBoundingClientRect();
		const nx = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1));
		const ny = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1));
		lean.target.y = nx * 0.12;
		lean.target.x = ny * 0.05;
	};
	const centre = () => {
		lean.target.x = 0;
		lean.target.y = 0;
	};
	window.addEventListener("pointermove", follow);
	document.documentElement.addEventListener("pointerleave", centre);

	const flight = { to: null, start: 0, duration: 0, ease: (t) => t, done: null, reverse: false, base: 0 };
	let progress = 0;

	function screenTarget(target) {
		const box = host.getBoundingClientRect();
		const ppu = pixelsPerUnit();
		const scale = target.capHeight / CAP / ppu;
		const leftUnits = (target.left - (box.left + box.width / 2)) / ppu;
		const baselineUnits = -(target.baseline - (box.top + box.height / 2)) / ppu;
		return { scale, x: leftUnits + (width / 2) * scale, y: baselineUnits + (CAP / 2) * scale };
	}

	function fly(target, { duration, ease, reverse }) {
		return new Promise((resolve) => {
			Object.assign(flight, { to: screenTarget(target), start: now(), duration: duration / 1000, ease, done: resolve, reverse });
		});
	}

	intro.base = options.days ? [...options.days] : null;
	const tweens = new Map();
	const tween = (key, from, to, duration, apply) => {
		tweens.set(key, { from, to, start: now(), duration, apply });
		apply(from);
	};
	const runTweens = () => {
		for (const [key, entry] of tweens) {
			const x = Math.min(1, (now() - entry.start) / entry.duration);
			entry.apply(entry.from + (entry.to - entry.from) * x * x * (3 - 2 * x));
			if (x >= 1) tweens.delete(key);
		}
	};

	const FIELD_ROWS = 15;
	const field = { perDay: null, texture: null, cols: 0 };
	const hash = (a, b) => {
		const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
		return value - Math.floor(value);
	};
	function buildField() {
		if (!field.perDay) return;
		const uniforms = backdrop.material.uniforms;
		const span = uniforms.uSize.value.x * 0.8;
		const cols = Math.max(1, Math.ceil(span / 0.16));
		if (cols !== field.cols) {
			field.texture?.dispose();
			field.texture = new THREE.DataTexture(new Uint8Array(cols * FIELD_ROWS * 4), cols, FIELD_ROWS, THREE.RGBAFormat);
			field.texture.magFilter = THREE.NearestFilter;
			field.texture.minFilter = THREE.NearestFilter;
			field.cols = cols;
		}
		const data = field.texture.image.data;
		data.fill(0);
		const columns = Array.from({ length: 30 }, () => []);
		for (let col = 0; col < cols; col += 1) {
			const x = -span / 2 + (col + 0.5) * 0.16;
			const day = Math.round(Math.min(1, Math.max(0, x / span + 0.5)) * 29);
			columns[day].push(col);
		}
		const slots = columns.map((list) => {
			const cells = [];
			for (let row = 0; row < FIELD_ROWS; row += 1) for (const col of list) if (hash(col, row) > 0.1) cells.push([col, row]);
			return cells;
		});
		field.perDay.forEach((list, day) => {
			const group = Math.max(1, Math.ceil(list.length / Math.max(1, slots[day].length)));
			for (let index = 0; index * group < list.length; index += 1) {
				const cell = slots[day][index];
				if (!cell) break;
				const value = Math.max(...list.slice(index * group, index * group + group));
				const offset = (cell[1] * cols + cell[0]) * 4;
				data[offset] = 255;
				data[offset + 1] = Math.round(Math.min(1, Math.max(0, value)) * 255);
				data[offset + 3] = 255;
			}
		});
		field.texture.needsUpdate = true;
		uniforms.uField.value = field.texture;
		uniforms.uFieldSize.value.set(cols, FIELD_ROWS);
	}

	const born = now();
	let frame = 0;
	const loop = () => {
		frame = tick(loop);
		if (!host.offsetParent || host.dataset.paused !== undefined) return;
		const time = now() - born;
		backdrop.material.uniforms.uTime.value = time;
		runTweens();
		if (intro.curving) {
			const x = Math.min(1, (now() - intro.curving) / 2.2);
			intro.curve = x * x * (3 - 2 * x);
			if (x >= 1) intro.curving = null;
		}
		const step = intro.last === null ? 0 : Math.min(0.05, now() - intro.last);
		intro.last = now();
		backdrop.material.uniforms.uPhase.value += step * (1 - intro.curve);
		backdrop.material.uniforms.uCurve.value = intro.curve;
		if (intro.shown) {
			const x = Math.min(1, (now() - intro.shown.start) / 1.8);
			intro.appear = intro.shown.from + (intro.shown.to - intro.shown.from) * (1 - (1 - x) ** 3);
			if (x >= 1) {
				const done = intro.shown.done;
				intro.shown = null;
				done();
			}
		}
		if (flight.to) {
			const raw = Math.min(1, Math.max(0, (now() - flight.start) / flight.duration));
			const eased = flight.ease(raw);
			progress = flight.reverse ? 1 - eased : eased;
			if (raw >= 1 && flight.done) {
				const done = flight.done;
				flight.done = null;
				done();
			}
		} else progress = flight.base;
		const rest = { scale: view.scale, x: view.x, y: view.y };
		const to = flight.to ?? rest;
		const hidden = 1 - intro.appear;
		tilt.scale.setScalar((rest.scale + (to.scale - rest.scale) * progress) * (1 - hidden * 0.12));
		tilt.position.set(rest.x + (to.x - rest.x) * progress, rest.y + (to.y - rest.y) * progress - hidden * 0.35, -hidden * 2.4);
		for (const axis of ["x", "y"]) {
			lean.velocity[axis] += (lean.target[axis] - lean.value[axis]) * 0.012;
			lean.velocity[axis] *= 0.9;
			lean.value[axis] += lean.velocity[axis];
		}
		const free = 1 - progress;
		tilt.rotation.set((-0.08 + lean.value.x) * free + hidden * 0.45, lean.value.y * free, 0);
		if (intro.lighting) {
			const since = now() - intro.lighting.start;
			intro.light = smooth(since / SWEEP_LIGHT_S);
			const travel = smooth(since / SWEEP_S);
			const close = 1 - travel * travel;
			const size = view.badge * ICON_HEIGHT;
			key.position.set(
				(view.x + size * (4.8 * travel - 2.4)) * close + keyLit.x * (1 - close),
				(view.y + size * 0.25) * close + keyLit.y * (1 - close),
				SWEEP_Z * close + keyLit.z * (1 - close),
			);
			key.intensity = KEY_INTENSITY * (1 - SWEEP_DIM * close);
			report(intro.light, close);
			if (since >= SWEEP_S) {
				const { done } = intro.lighting;
				intro.lighting = null;
				key.intensity = KEY_INTENSITY;
				report(1);
				done();
			}
		}
		if (intro.badgeShown) {
			const x = Math.min(1, (now() - intro.badgeShown.start) / 1.4);
			intro.badge = intro.badgeShown.from + (intro.badgeShown.to - intro.badgeShown.from) * (1 - (1 - x) ** 3);
			if (x >= 1) {
				const done = intro.badgeShown.done;
				intro.badgeShown = null;
				done();
			}
		}
		if (intro.finish) {
			const since = now() - intro.finish.start;
			const x = Math.min(1, since / 0.9);
			intro.lit = intro.finish.from + (1 - intro.finish.from) * x * x * (3 - 2 * x);
			const y = Math.min(1, Math.max(0, (since - 0.5) / 1.6));
			backdrop.material.uniforms.uLine.value = y * y * (3 - 2 * y);
		} else {
			intro.born ??= now();
			intro.lit = 0.9 * (1 - Math.exp(-Math.max(0, now() - intro.born - 1.0) / 3.2));
		}
		backdrop.material.uniforms.uLit.value = intro.lit;
		const away = 1 - intro.badge;
		badge.visible = intro.badge > 0.001;
		badge.scale.setScalar(view.badge * (1 - away * 0.12));
		badge.position.set(view.x, view.y - away * 0.35, -away * 2.4);
		badge.rotation.set(-0.08 + lean.value.x + away * 0.45, lean.value.y, 0);
		badgeGlass.opacity = intro.badge;
		badgeGlass.color.copy(dark).multiplyScalar(intro.light);
		badgeGlass.clearcoat = 0.12 * intro.light;
		glass.opacity = intro.appear;
		word.visible = intro.appear > 0.001;
		glass.color.lerpColors(dark, flat, progress);
		glass.roughness = 0.14 + progress * 0.5;
		backdrop.material.uniforms.uOpacity.value = 1 - progress;
		renderer.render(scene, camera);
	};

	const observer = new ResizeObserver(fit);
	observer.observe(host);
	observer.observe(anchor);
	fit();
	frame = tick(loop);

	return {
		set(text) {
			set(text);
			fit();
		},
		element: canvas,
		capRatio: 0.727,
		fly,
		settle(value) {
			flight.to = null;
			flight.base = value;
			progress = value;
		},
		curve(days) {
			if (intro.curve > 0 || intro.curving) return;
			const uniforms = backdrop.material.uniforms;
			uniforms.uDaysA.value = [...days];
			uniforms.uDaysB.value = [...days];
			intro.curving = now();
			intro.base = [...days];
		},
		metric(spec) {
			const uniforms = backdrop.material.uniforms;
			const mix = uniforms.uDaysMix.value;
			uniforms.uDaysA.value = uniforms.uDaysA.value.map((value, index) => value + (uniforms.uDaysB.value[index] - value) * mix);
			uniforms.uDaysB.value = [...(spec?.days ?? intro.base ?? uniforms.uDaysA.value)];
			uniforms.uDaysMix.value = 0;
			tween("days", 0, 1, 1.3, (value) => (uniforms.uDaysMix.value = value));
			if (spec) {
				const from = uniforms.uTone.value.clone();
				const to = new THREE.Color(...spec.tone);
				const start = uniforms.uToneMix.value;
				tween("tone", 0, 1, 1.3, (value) => {
					uniforms.uTone.value.copy(start > 0.001 ? from.clone().lerp(to, value) : to);
					uniforms.uToneMix.value = start + (1 - start) * value;
				});
				field.perDay = spec.sessions;
				buildField();
				tween("sessions", uniforms.uSessions.value, 1, 0.9, (value) => (uniforms.uSessions.value = value));
				tween("lift", uniforms.uLift.value, 0.7, 1.3, (value) => (uniforms.uLift.value = value));
			} else {
				tween("lift", uniforms.uLift.value, 0, 1.3, (value) => (uniforms.uLift.value = value));
				tween("tone", uniforms.uToneMix.value, 0, 1.3, (value) => (uniforms.uToneMix.value = value));
				tween("sessions", uniforms.uSessions.value, 0, 0.9, (value) => (uniforms.uSessions.value = value));
			}
		},
		theme,
		// direction: [x, y] the colors run along, y up; [1, 0] is left to right.
		tint(colors, duration = 0.9, direction = [1, 0]) {
			const uniforms = backdrop.material.uniforms;
			const stops = [uniforms.uTintA.value, uniforms.uTintB.value, uniforms.uTintC.value];
			const from = stops.map((stop) => stop.clone());
			const target = colors ? colors.map((color) => new THREE.Color(color)) : from;
			const dir = uniforms.uTintDir.value;
			const fromDir = dir.clone();
			const toDir = colors ? new THREE.Vector2(...direction) : fromDir;
			const start = uniforms.uTint.value;
			const end = colors ? 1 : 0;
			const blend = start > 0.001;
			tween("tint", 0, 1, duration, (value) => {
				stops.forEach((stop, index) => stop.copy(blend ? from[index].clone().lerp(target[index], value) : target[index]));
				dir.copy(blend ? fromDir.clone().lerp(toDir, value) : toDir);
				uniforms.uTint.value = start + (end - start) * value;
			});
		},
		handoff(duration = 1.1, to = 1) {
			const from = backdrop.material.uniforms.uHand.value;
			return new Promise((done) => {
				tween("hand", from, to, duration, (value) => {
					backdrop.material.uniforms.uHand.value = value;
					if (Math.abs(value - to) < 1e-6) done();
				});
			});
		},
		finish() {
			if (intro.finish) return Promise.resolve();
			intro.finish = { start: now(), from: intro.lit };
			if (!options.badge) return new Promise((done) => setTimeout(done, 900));
			return new Promise((done) => setTimeout(done, 700)).then(() => animateBadge(true, true));
		},
		badge: animateBadge,
		appear(on) {
			intro.shown?.done();
			return new Promise((done) => {
				intro.shown = { from: intro.appear, to: on ? 1 : 0, start: now(), done };
			});
		},
		destroy() {
			key.position.copy(keyRest);
			report(1);
			untick(frame);
			observer.disconnect();
			window.removeEventListener("pointermove", follow);
			document.documentElement.removeEventListener("pointerleave", centre);
			for (const geometry of glyphs.values()) geometry.dispose();
			glass.dispose();
			field.texture?.dispose();
			badgeGlass.dispose();
			for (const mesh of badge.children) mesh.geometry.dispose();
			backdrop.geometry.dispose();
			backdrop.material.dispose();
			pmrem.dispose();
			renderer.dispose();
			canvas.remove();
		},
	};
}

window.glass3d = { mount };
