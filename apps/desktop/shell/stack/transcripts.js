const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const KEEP_DAYS = 36_500;

function claudeSettingsPath(env = process.env) {
	const root =
		env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");
	return path.join(root, "settings.json");
}

function keepClaudeTranscripts(file = claudeSettingsPath()) {
	if (!fs.existsSync(path.dirname(file)))
		return { changed: false, reason: "no-claude" };
	let settings = {};
	if (fs.existsSync(file)) {
		try {
			settings = JSON.parse(fs.readFileSync(file, "utf8"));
		} catch {
			return { changed: false, reason: "unreadable" };
		}
		if (!settings || typeof settings !== "object" || Array.isArray(settings))
			return { changed: false, reason: "unreadable" };
	}
	if (settings.cleanupPeriodDays !== undefined)
		return {
			changed: false,
			reason: "user-setting",
			days: settings.cleanupPeriodDays,
		};
	const next = { ...settings, cleanupPeriodDays: KEEP_DAYS };
	const temporary = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
	fs.renameSync(temporary, file);
	return { changed: true, days: KEEP_DAYS };
}

module.exports = { KEEP_DAYS, claudeSettingsPath, keepClaudeTranscripts };
