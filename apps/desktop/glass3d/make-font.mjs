import fs from "node:fs";
import opentype from "opentype.js";

const [source, target] = process.argv.slice(2);
const font = opentype.loadSync(source);
const scale = 100000 / ((font.unitsPerEm || 2048) * 72);
const round = Math.round;
const glyphs = {};
for (const char of "0123456789,.") {
	const glyph = font.charToGlyph(char);
	const box = glyph.getBoundingBox();
	let outline = "";
	for (const command of glyph.path.commands) {
		const type = command.type === "C" ? "b" : command.type.toLowerCase();
		outline += `${type} `;
		if (command.x !== undefined) outline += `${round(command.x * scale)} ${round(command.y * scale)} `;
		if (command.x1 !== undefined) outline += `${round(command.x1 * scale)} ${round(command.y1 * scale)} `;
		if (command.x2 !== undefined) outline += `${round(command.x2 * scale)} ${round(command.y2 * scale)} `;
	}
	glyphs[char] = { ha: round(glyph.advanceWidth * scale), x_min: round(box.x1 * scale), x_max: round(box.x2 * scale), o: outline };
}
const data = { glyphs, familyName: font.getEnglishName("fullName"), ascender: round(font.ascender * scale), descender: round(font.descender * scale), underlinePosition: 0, underlineThickness: 0, boundingBox: { xMin: 0, xMax: 0, yMin: 0, yMax: 0 }, resolution: 1000 };
fs.writeFileSync(target, `export default ${JSON.stringify(data)};\n`);
console.log(data.familyName, Object.keys(glyphs).join(""), `${Math.round(fs.statSync(target).size / 1024)} KB`);
