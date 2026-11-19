import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const shell = join(here, "..", "..");
const source = join(shell, "icon", "Opaline.icon");
const font = join(shell, "onboarding", "fonts", "InterVariable.woff2");
const ictool = "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool";
const { chromium } = createRequire(join(shell, "..", "..", "..", "package.json"))("@playwright/test");

const SIZE = 512;
const GROUP_SCALE = 1.15;
const HOLE = 1.25;
const NUMBER_SCALE = 0.5;
const NUMBER_EDGE_POINTS = 6;
const CX = 999.6;
const CY = 999.7;
const RING_TOP = 258;
const RING_BOTTOM = 1741;
const NUMBER_SIZE = 210 * (GROUP_SCALE / 0.9) * HOLE / (0.9375 * GROUP_SCALE * 0.512);
const INK = {
	white: { face: ["#FFFFFF", "#F6F6F8", "#D5D6DC"], edge: "#B9BAC2", empty: "#FF5A66", emptyEdge: "#A8323B" },
	black: { face: ["#25262D", "#0D0E12", "#030407"], edge: "#050506", empty: "#D93A4A", emptyEdge: "#7A1E27" },
};

function scalePath(d, f) {
	const out = [];
	const nums = [];
	const flush = () => {
		for (let i = 0; i < nums.length; i += 2) out.push(`${(CX + (nums[i] - CX) * f).toFixed(3)} ${(CY + (nums[i + 1] - CY) * f).toFixed(3)}`);
		nums.length = 0;
	};
	for (const token of d.match(/[MLCZ]|-?\d+\.?\d*/g)) {
		if (/[MLCZ]/.test(token)) {
			flush();
			out.push(token);
		} else nums.push(Number(token));
	}
	flush();
	return out.join(" ");
}

function widenHole(d) {
	const [outer, ...holes] = d.split(/(?=M)/).filter((part) => part.trim());
	return [outer.trim(), ...holes.map((hole) => scalePath(hole, HOLE))].join(" ");
}

function decode(file) {
	const bytes = readFileSync(file);
	let offset = 8;
	const idat = [];
	let width;
	let height;
	let channels;
	while (offset < bytes.length) {
		const length = bytes.readUInt32BE(offset);
		const type = bytes.toString("ascii", offset + 4, offset + 8);
		const data = bytes.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			channels = data[9] === 6 ? 4 : 3;
		}
		if (type === "IDAT") idat.push(data);
		offset += 12 + length;
	}
	const stride = width * channels;
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const pixels = Buffer.alloc(width * height * 4);
	let previous = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const current = Buffer.alloc(stride);
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? current[x - channels] : 0;
			const up = previous[x];
			const corner = x >= channels ? previous[x - channels] : 0;
			let value = line[x];
			if (filter === 1) value += left;
			else if (filter === 2) value += up;
			else if (filter === 3) value += (left + up) >> 1;
			else if (filter === 4) {
				const p = left + up - corner;
				const pa = Math.abs(p - left);
				const pb = Math.abs(p - up);
				const pc = Math.abs(p - corner);
				value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
			}
			current[x] = value & 255;
		}
		for (let x = 0; x < width; x++) {
			for (let k = 0; k < 3; k++) pixels[(y * width + x) * 4 + k] = current[x * channels + k];
			pixels[(y * width + x) * 4 + 3] = channels === 4 ? current[x * 4 + 3] : 255;
		}
		previous = current;
	}
	return { width, height, pixels };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type), data]);
	let c = 0xffffffff;
	for (const byte of body) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
	return Buffer.concat([length, body, crc]);
}

function encode(file, { width, height, pixels }) {
	const raw = Buffer.alloc(height * (width * 4 + 1));
	for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}

function render(icon, file, rendition = "Default") {
	execFileSync(ictool, [icon, "--export-image", "--output-file", file, "--platform", "macOS", "--rendition", rendition, "--width", String(SIZE * 0.9375), "--height", String(SIZE * 0.9375), "--scale", "1"]);
	execFileSync("sips", ["-p", String(SIZE), String(SIZE), file, "--out", file]);
	return decode(file);
}

function matte(onBlack, onWhite) {
	const pixels = Buffer.alloc(onBlack.pixels.length);
	for (let i = 0; i < pixels.length; i += 4) {
		const x = (i / 4) % onBlack.width;
		const y = Math.floor(i / 4 / onBlack.width);
		const inset = onBlack.width * 0.047;
		if (x < inset || y < inset || x > onBlack.width - inset || y > onBlack.height - inset) continue;
		if (onBlack.pixels[i + 3] < 250 || onWhite.pixels[i + 3] < 250) continue;
		let alpha = 0;
		for (let k = 0; k < 3; k++) alpha += 1 - (onWhite.pixels[i + k] - onBlack.pixels[i + k]) / 255;
		alpha = Math.max(0, Math.min(1, alpha / 3));
		if (alpha < 0.01) continue;
		for (let k = 0; k < 3; k++) pixels[i + k] = Math.max(0, Math.min(255, Math.round(onBlack.pixels[i + k] / alpha)));
		pixels[i + 3] = Math.round(alpha * 255);
	}
	return { width: onBlack.width, height: onBlack.height, pixels };
}

function appearance(group, dark) {
	return {
		...group,
		layers: group.layers.map((layer) => {
			const hidden = layer["hidden-specializations"];
			if (!hidden) return layer;
			const value = hidden.find((entry) => entry.appearance === (dark ? "dark" : undefined))?.value ?? hidden.find((entry) => !entry.appearance)?.value ?? false;
			return { ...layer, "hidden-specializations": [{ value }] };
		}),
		translucency: dark ? (group["translucency-specializations"]?.find((entry) => entry.appearance === "dark")?.value ?? group.translucency) : group.translucency,
		"translucency-specializations": undefined,
	};
}

function solid(gray) {
	const c = gray.toFixed(5);
	return { solid: `srgb:${c},${c},${c},1.00000` };
}

async function glyphLayers(page, values) {
	const css = `@font-face{font-family:Inter;src:url("data:font/woff2;base64,${readFileSync(font).toString("base64")}") format("woff2");font-weight:100 900}`;
	const layers = {};
	const pixel = (unit) => unit * 0.512;
	const gradientTop = pixel(CY + (RING_TOP - CY) / NUMBER_SCALE);
	const gradientBottom = pixel(CY + (RING_BOTTOM - CY) / NUMBER_SCALE);
	await page.setContent(`<html><head><style>${css}</style></head><body style="margin:0;background:transparent"><canvas width="1024" height="1024"></canvas></body></html>`);
	await page.evaluate(() => document.fonts.load('800 100px "Inter"'));
	for (const value of values) {
		layers[value] = {};
		for (const [ink, kind] of [["white", "face"], ["white", "edge"], ["black", "face"], ["black", "edge"]]) {
			const colors = INK[ink];
			const empty = value === 0;
			const fill = empty ? (kind === "face" ? colors.empty : colors.emptyEdge) : kind === "face" ? colors.face : colors.edge;
			const size = pixel(NUMBER_SIZE / NUMBER_SCALE) * (value >= 100 ? 0.72 : 1);
			layers[value][`${ink}-${kind}`] = await page.evaluate(
				({ text, size, fill, top, bottom, cx, cy }) => {
					const canvas = document.querySelector("canvas");
					const context = canvas.getContext("2d");
					context.clearRect(0, 0, 1024, 1024);
					context.font = `800 ${size}px Inter`;
					context.letterSpacing = `${-size * 0.035}px`;
					const box = context.measureText(text);
					const x = cx - (box.actualBoundingBoxRight - box.actualBoundingBoxLeft) / 2 + box.actualBoundingBoxLeft;
					const y = cy + (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2;
					if (Array.isArray(fill)) {
						const gradient = context.createLinearGradient(0, top, 0, bottom);
						gradient.addColorStop(0, fill[0]);
						gradient.addColorStop(0.55, fill[1]);
						gradient.addColorStop(1, fill[2]);
						context.fillStyle = gradient;
					} else context.fillStyle = fill;
					context.fillText(text, x, y);
					return canvas.toDataURL("image/png").split(",")[1];
				},
				{ text: String(value), size, fill, top: gradientTop, bottom: gradientBottom, cx: pixel(CX), cy: pixel(CY) },
			);
		}
	}
	return layers;
}

function writeIcon(dir, edit) {
	rmSync(dir, { recursive: true, force: true });
	cpSync(source, dir, { recursive: true });
	const assets = join(dir, "Assets");
	for (const name of ["ring-black.svg", "ring-white.svg", "ring-black-edge.svg", "ring-white-edge.svg"]) {
		const file = join(assets, name);
		writeFileSync(file, readFileSync(file, "utf8").replace(/ d="([^"]*)"/g, (_, d) => ` d="${widenHole(d)}"`));
	}
	for (const name of ["frost.svg"]) {
		const file = join(assets, name);
		writeFileSync(file, readFileSync(file, "utf8").replace(/ d="([^"]*)"/g, (_, d) => ` d="${scalePath(d, HOLE)}"`));
	}
	const json = JSON.parse(readFileSync(join(dir, "icon.json"), "utf8"));
	for (const group of json.groups) group.position = { ...group.position, scale: GROUP_SCALE };
	edit(json, assets);
	writeFileSync(join(dir, "icon.json"), JSON.stringify(json, null, 2));
}

function renderPart(work, name, dark, groups, assetsFrom) {
	const dir = join(work, `${name}.icon`);
	writeIcon(dir, (json, assets) => {
		const byName = Object.fromEntries(json.groups.map((group) => [group.name, group]));
		json.groups = groups(byName).map((group) => appearance(group, dark));
		assetsFrom?.(assets);
	});
	const json = JSON.parse(readFileSync(join(dir, "icon.json"), "utf8"));
	const onFill = (gray) => {
		json.fill = solid(gray);
		delete json["fill-specializations"];
		writeFileSync(join(dir, "icon.json"), JSON.stringify(json, null, 2));
		return render(dir, join(work, `${name}-${gray}.png`));
	};
	return matte(onFill(0), onFill(1));
}

async function main() {
	const work = mkdtempSync(join(tmpdir(), "opaline-dock-"));
	const browser = await chromium.launch({ channel: "chrome" });
	const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
	const values = process.env.DOCK_VALUES ? process.env.DOCK_VALUES.split(",").map(Number) : Array.from({ length: 101 }, (_, value) => value);
	const glyphs = await glyphLayers(page, values);
	await browser.close();
	for (const dark of [false, true]) {
		const out = join(here, dark ? "dark" : "light");
		mkdirSync(out, { recursive: true });
		const baseDir = join(work, `base-${dark}.icon`);
		writeIcon(baseDir, (json) => {
			json.groups = json.groups.filter((group) => group.name === "Frost");
		});
		encode(join(out, "base.png"), render(baseDir, join(work, `base-${dark}.png`), dark ? "Dark" : "Default"));
		encode(join(out, "ring.png"), renderPart(work, `ring-${dark}`, dark, (byName) => [byName.Ring]));
		for (const value of values) {
			const part = renderPart(
				work,
				`number-${dark}-${value}`,
				dark,
				(byName) => {
					const ring = byName.Ring;
					return [
						{
							...ring,
							name: "Number",
							position: { ...ring.position, scale: GROUP_SCALE * NUMBER_SCALE },
							layers: ring.layers.map((layer) => ({
								...layer,
								"image-name": layer["image-name"].replace("ring", "number").replace(".svg", ".png"),
								...(layer.position ? { position: { ...layer.position, "translation-in-points": [0, NUMBER_EDGE_POINTS] } } : {}),
							})),
						},
					];
				},
				(assets) => {
					for (const ink of ["white", "black"]) {
						writeFileSync(join(assets, `number-${ink}.png`), Buffer.from(glyphs[value][`${ink}-face`], "base64"));
						writeFileSync(join(assets, `number-${ink}-edge.png`), Buffer.from(glyphs[value][`${ink}-edge`], "base64"));
					}
				},
			);
			encode(join(out, `${value}.png`), part);
		}
	}
	rmSync(work, { recursive: true, force: true });
}

await main();
