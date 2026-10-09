import { createHeroCanvasBlur } from "./hero-canvas-blur";

import {
	INSTANT_V2_GLIMM_PALETTE,
	INTERRUPTED_GLIMM_PALETTE,
	PENDING_GLIMM_PALETTE,
	PERSONAL_GLIMM_PALETTE,
} from "./instant-v2-glimm-palette";

const permutation = [
	151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140,
	36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234,
	75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237,
	149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48,
	27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105,
	92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73,
	209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86,
	164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38,
	147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189,
	28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101,
	155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232,
	178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12,
	191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31,
	181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254,
	138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215,
	61, 156, 180,
];

const perlinTable = new Uint16Array(512);
for (let index = 0; index < perlinTable.length; index += 1) {
	perlinTable[index] = permutation[index & 255];
}

const fade = (value: number) =>
	value * value * value * (value * (value * 6 - 15) + 10);

const gradient = (hash: number, x: number, y: number, z: number) => {
	const value = hash & 15;
	const first = value < 8 ? x : y;
	const second = value < 4 ? y : value === 12 || value === 14 ? x : z;
	return (value & 1 ? -first : first) + (value & 2 ? -second : second);
};

const perlinNoise = (x: number, y: number, z: number) => {
	const floorX = Math.floor(x);
	const floorY = Math.floor(y);
	const floorZ = Math.floor(z);
	const tableX = floorX & 255;
	const tableY = floorY & 255;
	const tableZ = floorZ & 255;
	x -= floorX;
	y -= floorY;
	z -= floorZ;
	const previousX = x - 1;
	const previousY = y - 1;
	const previousZ = z - 1;
	const blendX = fade(x);
	const blendY = fade(y);
	const blendZ = fade(z);
	const a = perlinTable[tableX] + tableY;
	const aa = perlinTable[a] + tableZ;
	const ab = perlinTable[a + 1] + tableZ;
	const b = perlinTable[tableX + 1] + tableY;
	const ba = perlinTable[b] + tableZ;
	const bb = perlinTable[b + 1] + tableZ;
	const mix = (start: number, end: number, progress: number) =>
		start + progress * (end - start);
	const front = mix(
		mix(
			gradient(perlinTable[aa], x, y, z),
			gradient(perlinTable[ba], previousX, y, z),
			blendX,
		),
		mix(
			gradient(perlinTable[ab], x, previousY, z),
			gradient(perlinTable[bb], previousX, previousY, z),
			blendX,
		),
		blendY,
	);
	const back = mix(
		mix(
			gradient(perlinTable[aa + 1], x, y, previousZ),
			gradient(perlinTable[ba + 1], previousX, y, previousZ),
			blendX,
		),
		mix(
			gradient(perlinTable[ab + 1], x, previousY, previousZ),
			gradient(perlinTable[bb + 1], previousX, previousY, previousZ),
			blendX,
		),
		blendY,
	);
	return mix(front, back, blendZ);
};

const buildTerrain = () => {
	const segments = 100;
	const rowLength = segments + 1;
	const positions = new Float32Array(rowLength * rowLength * 3);
	let positionOffset = 0;
	for (let row = 0; row <= segments; row += 1) {
		const z = -100 + row * 2;
		for (let column = 0; column <= segments; column += 1) {
			const x = -100 + column * 2;
			positions[positionOffset++] = x;
			positions[positionOffset++] = 30 * perlinNoise(x / 200, z / 200, 8);
			positions[positionOffset++] = z;
		}
	}
	const indices = new Uint16Array(segments * segments * 6);
	let indexOffset = 0;
	for (let row = 0; row < segments; row += 1) {
		for (let column = 0; column < segments; column += 1) {
			const a = row * rowLength + column;
			const b = (row + 1) * rowLength + column;
			const c = (row + 1) * rowLength + column + 1;
			const d = row * rowLength + column + 1;
			indices[indexOffset++] = a;
			indices[indexOffset++] = b;
			indices[indexOffset++] = d;
			indices[indexOffset++] = b;
			indices[indexOffset++] = c;
			indices[indexOffset++] = d;
		}
	}
	return { indices, positions };
};

const vertexSource = `#version 300 es
	precision highp float;
	in vec3 position;
	uniform mat4 modelViewMatrix;
	uniform mat4 projectionMatrix;
	out vec3 vPos;
	void main() {
		vPos = position;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const fragmentSource = `#version 300 es
	precision highp float;
	uniform float time;
	uniform float lineOpacity;
	uniform float brightness;
	uniform bool clampColor;
	uniform vec3 paletteA;
	uniform vec3 paletteB;
	uniform vec3 paletteC;
	uniform vec3 paletteD;
	uniform vec3 personalPaletteA;
	uniform vec3 personalPaletteB;
	uniform vec3 personalPaletteC;
	uniform vec3 personalPaletteD;
	uniform vec3 pendingPaletteA;
	uniform vec3 pendingPaletteB;
	uniform vec3 pendingPaletteC;
	uniform vec3 pendingPaletteD;
	uniform vec3 interruptedPaletteA;
	uniform vec3 interruptedPaletteB;
	uniform vec3 interruptedPaletteC;
	uniform vec3 interruptedPaletteD;
	uniform vec4 paletteWeights;
	in vec3 vPos;
	out vec4 color;

	#define PI 3.14159265359

	vec3 glimmPalette(float phase) {
		vec3 original = paletteA + paletteB * cos(2.0 * PI * (paletteC * phase + paletteD));
		vec3 personal = personalPaletteA + personalPaletteB * cos(2.0 * PI * (personalPaletteC * phase + personalPaletteD));
		vec3 pending = pendingPaletteA + pendingPaletteB * cos(2.0 * PI * (pendingPaletteC * phase + pendingPaletteD));
		vec3 interrupted = interruptedPaletteA + interruptedPaletteB * cos(2.0 * PI * (interruptedPaletteC * phase + interruptedPaletteD));
		return original * paletteWeights.x + pending * paletteWeights.y + personal * paletteWeights.z + interrupted * paletteWeights.w;
	}

	void main() {
		float paletteDrift = time * 0.11;
		float paletteBend = sin(vPos.z * 0.04 + time * 0.32) * 0.09;
		float palettePhase = paletteDrift + paletteBend + vPos.x * 0.024 + vPos.z * 0.004;
		vec3 surfaceColor = glimmPalette(palettePhase);
		surfaceColor *= brightness;
		color = vec4(clampColor ? clamp(surfaceColor, 0.0, 1.0) : surfaceColor, lineOpacity);
	}
`;

// The canvas is opaque and sits on the page, so it clears to the page's own
// colour: white in light mode (as it always has), and in dark mode whichever
// of <html> or <body> carries the dark surface.
function readPageColor(): [number, number, number] {
	if (!document.documentElement.classList.contains("dark")) return [1, 1, 1];
	const context = document
		.createElement("canvas")
		.getContext("2d", { willReadFrequently: true });
	if (!context) return [1, 1, 1];
	for (const element of [document.documentElement, document.body]) {
		context.clearRect(0, 0, 1, 1);
		context.fillStyle = getComputedStyle(element).backgroundColor;
		context.fillRect(0, 0, 1, 1);
		const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
		if (alpha > 0) return [red / 255, green / 255, blue / 255];
	}
	return [1, 1, 1];
}

// Dark mode tunes the glow from CSS: --landing-hero-canvas-strength scales its
// opacity, --landing-hero-canvas-brightness its colours (glimm's advice for
// dark backgrounds: pale colours at full brightness read as harsh white).
function readCanvasVariable(name: string) {
	const value = Number.parseFloat(
		getComputedStyle(document.documentElement).getPropertyValue(name),
	);
	return Number.isFinite(value) ? value : 1;
}

export function initializeHeroCanvas(
	canvas: HTMLCanvasElement,
	blurSurface: HTMLElement | null = null,
) {
	const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const lifecycle = new AbortController();
	let disposed = false;
	let disposeRenderer = () => {};
	const stage = canvas.closest<HTMLElement>("[data-hero-canvas-stage]");

	const start = async () => {
		if (disposed) return;
		const gl = canvas.getContext("webgl2", {
			alpha: blurSurface !== null,
			antialias: false,
			depth: true,
			powerPreference: "low-power",
			premultipliedAlpha: true,
			preserveDrawingBuffer: false,
		});
		if (!gl) return;
		if ("drawingBufferColorSpace" in gl) gl.drawingBufferColorSpace = "srgb";
		const parallelCompile = gl.getExtension("KHR_parallel_shader_compile");

		const compile = (type: number, source: string) => {
			const shader = gl.createShader(type);
			if (!shader) return null;
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			return shader;
		};
		const vertex = compile(gl.VERTEX_SHADER, vertexSource);
		const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
		if (!vertex || !fragment) return;
		const program = gl.createProgram();
		if (!program) return;
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		const disposeProgram = () => {
			gl.deleteProgram(program);
			gl.deleteShader(vertex);
			gl.deleteShader(fragment);
		};
		disposeRenderer = disposeProgram;
		// Compile both shaders together, then poll without making Safari wait
		// for the GPU on the main thread during a fresh load or first scroll.
		while (
			!disposed &&
			parallelCompile &&
			!gl.getProgramParameter(program, parallelCompile.COMPLETION_STATUS_KHR)
		) {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		}
		if (disposed) return;
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.error(gl.getProgramInfoLog(program));
			console.error(gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment));
			disposeRenderer();
			return;
		}

		const { indices, positions } = buildTerrain();
		const positionBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
		const indexBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
		// biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook.
		gl.useProgram(program);
		const position = gl.getAttribLocation(program, "position");
		gl.enableVertexAttribArray(position);
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
		gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 12, 0);

		const modelViewMatrix = gl.getUniformLocation(program, "modelViewMatrix");
		const projectionMatrix = gl.getUniformLocation(program, "projectionMatrix");
		const time = gl.getUniformLocation(program, "time");
		gl.uniformMatrix4fv(
			modelViewMatrix,
			false,
			new Float32Array([
				1, 0, 0, 0, 0, 0.0001, 1, 0, 0, -1, 0.0001, 0, 0, -0.01, -100, 1,
			]),
		);
		const setPaletteUniform = (
			name: string,
			[colorRed, colorGreen, colorBlue]: [number, number, number],
		) => {
			gl.uniform3f(
				gl.getUniformLocation(program, name),
				colorRed,
				colorGreen,
				colorBlue,
			);
		};
		setPaletteUniform("paletteA", INSTANT_V2_GLIMM_PALETTE.a);
		setPaletteUniform("paletteB", INSTANT_V2_GLIMM_PALETTE.b);
		setPaletteUniform("paletteC", INSTANT_V2_GLIMM_PALETTE.c);
		setPaletteUniform("paletteD", INSTANT_V2_GLIMM_PALETTE.d);
		setPaletteUniform("personalPaletteA", PERSONAL_GLIMM_PALETTE.a);
		setPaletteUniform("personalPaletteB", PERSONAL_GLIMM_PALETTE.b);
		setPaletteUniform("personalPaletteC", PERSONAL_GLIMM_PALETTE.c);
		setPaletteUniform("personalPaletteD", PERSONAL_GLIMM_PALETTE.d);
		setPaletteUniform("pendingPaletteA", PENDING_GLIMM_PALETTE.a);
		setPaletteUniform("pendingPaletteB", PENDING_GLIMM_PALETTE.b);
		setPaletteUniform("pendingPaletteC", PENDING_GLIMM_PALETTE.c);
		setPaletteUniform("pendingPaletteD", PENDING_GLIMM_PALETTE.d);
		setPaletteUniform("interruptedPaletteA", INTERRUPTED_GLIMM_PALETTE.a);
		setPaletteUniform("interruptedPaletteB", INTERRUPTED_GLIMM_PALETTE.b);
		setPaletteUniform("interruptedPaletteC", INTERRUPTED_GLIMM_PALETTE.c);
		setPaletteUniform("interruptedPaletteD", INTERRUPTED_GLIMM_PALETTE.d);
		const paletteWeights = gl.getUniformLocation(program, "paletteWeights");
		const readPaletteIndex = () => {
			switch (stage?.dataset.heroCanvasPalette) {
				case "pending":
					return 1;
				case "connected":
					return 2;
				case "interrupted":
					return 3;
				default:
					return 0;
			}
		};
		let targetPalette = readPaletteIndex();
		let paletteTransitionStart = performance.now();
		const weights = new Float32Array(4);
		weights[targetPalette] = 1;
		const previousWeights = weights.slice();
		const requestedOpacity = Number(stage?.dataset.heroCanvasOpacity);
		const canvasOpacity = Number.isFinite(requestedOpacity)
			? Math.min(1, Math.max(0, requestedOpacity))
			: 1;
		const lineOpacity = gl.getUniformLocation(program, "lineOpacity");
		const brightness = gl.getUniformLocation(program, "brightness");
		gl.uniform1i(
			gl.getUniformLocation(program, "clampColor"),
			blurSurface ? 1 : 0,
		);
		gl.enable(gl.BLEND);
		gl.blendEquation(gl.FUNC_ADD);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.frontFace(gl.CCW);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);

		const disposeTerrain = () => {
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(indexBuffer);
			disposeProgram();
		};
		disposeRenderer = disposeTerrain;
		const blur = blurSurface
			? await createHeroCanvasBlur(gl, canvas, blurSurface, lifecycle.signal)
			: null;
		if (disposed) {
			blur?.dispose();
			return;
		}
		const projection = new Float32Array(16);
		const resize = () => {
			const bounds = blur?.bounds() ?? canvas.getBoundingClientRect();
			const dpr = blur?.pixelRatio() ?? Math.min(1.5, devicePixelRatio || 1);
			// CSS transforms change presentation, not the drawing resolution.
			// In particular, the scroll stretch must not reallocate WebGL buffers.
			const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
			const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
			if (canvas.width !== width || canvas.height !== height) {
				if (canvas.width !== width) canvas.width = width;
				if (canvas.height !== height) canvas.height = height;
				gl.viewport(0, 0, width, height);
			}
			// The blurred backdrop uses stable layout bounds; the product keeps its framing.
			const visualWidth = Math.max(1, Math.round(bounds.width * dpr));
			const visualHeight = Math.max(1, Math.round(bounds.height * dpr));
			projection.fill(0);
			projection[0] = visualHeight / (25 * visualWidth);
			projection[5] = 0.04;
			projection[10] = -2 / 999.9;
			projection[14] = -1000.1 / 999.9;
			projection[15] = 1;
			gl.uniformMatrix4fv(projectionMatrix, false, projection);
		};

		const fixedTime = new URLSearchParams(location.search).get(
			"opaline-canvas-time",
		);
		const fixedSeconds = fixedTime === null ? null : Number(fixedTime) || 0;
		let elapsedBeforePause = 0;
		let resumedAt = performance.now();
		let frame = 0;
		let visible = true;
		let pageColor = readPageColor();
		let canvasStrength = readCanvasVariable("--landing-hero-canvas-strength");
		let canvasBrightness = readCanvasVariable(
			"--landing-hero-canvas-brightness",
		);
		const paint = (now: number) => {
			resize();
			blur?.begin();
			gl.clearColor(...pageColor, 1);
			gl.clearDepth(1);
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
			const forcedTime = Number(
				document.documentElement.dataset.opalineCanvasTime,
			);
			const elapsed =
				fixedSeconds === null
					? elapsedBeforePause + (now - resumedAt) / 1000
					: Number.isFinite(forcedTime)
						? forcedTime
						: fixedSeconds;
			gl.uniform1f(time, elapsed);
			gl.uniform1f(lineOpacity, Math.min(1, canvasOpacity * canvasStrength));
			gl.uniform1f(brightness, canvasBrightness);
			const nextPalette = readPaletteIndex();
			if (nextPalette !== targetPalette) {
				previousWeights.set(weights);
				targetPalette = nextPalette;
				paletteTransitionStart = now;
			}
			const blend = reducedMotion
				? 1
				: Math.min(1, (now - paletteTransitionStart) / 1800);
			const eased = blend * blend * (3 - 2 * blend);
			for (let index = 0; index < weights.length; index++) {
				weights[index] =
					previousWeights[index] * (1 - eased) +
					(index === targetPalette ? eased : 0);
			}
			gl.uniform4fv(paletteWeights, weights);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
			blur?.end();
			stage?.setAttribute("data-canvas-ready", "");
		};
		const draw = (now: number) => {
			frame = 0;
			if (!visible || document.hidden) return;
			paint(now);
			if (!reducedMotion && fixedSeconds === null)
				frame = requestAnimationFrame(draw);
		};
		const pause = () => {
			if (frame !== 0 && fixedSeconds === null) {
				elapsedBeforePause += (performance.now() - resumedAt) / 1000;
			}
			cancelAnimationFrame(frame);
			frame = 0;
		};
		const resume = () => {
			if (reducedMotion || frame !== 0 || !visible || document.hidden) {
				return;
			}
			resumedAt = performance.now();
			frame = requestAnimationFrame(draw);
		};
		const visibilityObserver = new IntersectionObserver(
			([entry]) => {
				visible = entry.isIntersecting;
				if (visible) {
					paint(performance.now());
					resume();
				} else {
					pause();
				}
			},
			{ rootMargin: "100% 0px" },
		);
		visibilityObserver.observe(canvas);
		document.addEventListener(
			"visibilitychange",
			() => {
				if (document.hidden) pause();
				else if (visible) {
					paint(performance.now());
					resume();
				}
			},
			{ signal: lifecycle.signal },
		);
		// Reduced motion still repaints when connection state changes, without
		// restarting the canvas or running a continuous animation loop.
		const paletteObserver = new MutationObserver(() => {
			if (visible && !document.hidden) paint(performance.now());
		});
		if (stage)
			paletteObserver.observe(stage, {
				attributeFilter: ["data-hero-canvas-palette"],
				attributes: true,
			});
		// The landing page follows the device's dark mode through html.dark.
		const themeObserver = new MutationObserver(() => {
			pageColor = readPageColor();
			canvasStrength = readCanvasVariable("--landing-hero-canvas-strength");
			canvasBrightness = readCanvasVariable("--landing-hero-canvas-brightness");
			if (visible && !document.hidden) paint(performance.now());
		});
		themeObserver.observe(document.documentElement, {
			attributeFilter: ["class"],
			attributes: true,
		});
		addEventListener("resize", () => paint(performance.now()), {
			passive: true,
			signal: lifecycle.signal,
		});
		disposeRenderer = () => {
			pause();
			visibilityObserver.disconnect();
			paletteObserver.disconnect();
			themeObserver.disconnect();
			blur?.dispose();
			disposeTerrain();
		};
		paint(performance.now());
		resume();
	};

	requestAnimationFrame(() => {
		void start().catch((error: unknown) => {
			disposeRenderer();
			if (!disposed)
				console.error("Could not initialize gradient canvas", error);
		});
	});
	return () => {
		disposed = true;
		lifecycle.abort();
		disposeRenderer();
	};
}
