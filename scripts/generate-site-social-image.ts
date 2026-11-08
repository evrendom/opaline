import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderSiteCardPng } from "../apps/api/src/services/team-invite-card-image.js";

const directory = resolve(import.meta.dir, "../apps/marketing/public/images");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "opaline-social.png"), await renderSiteCardPng());
console.log("Generated the marketing preview using the workspace invitation card design.");
