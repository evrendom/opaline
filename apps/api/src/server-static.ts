import { join } from "node:path";
import { createStaticFallback, type StaticFallback } from "./static-site.js";

export type ServerStaticFallback = StaticFallback;

export function createServerStaticFallback(): ServerStaticFallback {
	return createStaticFallback({
		directory: join(import.meta.dir, "..", process.env.STATIC_DIR ?? "public"),
		pluginBuildDirectory: join(import.meta.dir, "../../web/dist-plugin"),
	});
}
