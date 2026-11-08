import { join } from "node:path";
import { createStaticFallback, type StaticFallback } from "./static-site.js";

export type FlyStaticFallback = StaticFallback;

export function createFlyStaticFallback(): FlyStaticFallback {
	return createStaticFallback({
		directory: join(import.meta.dir, "..", process.env.STATIC_DIR ?? "public"),
		pluginBuildDirectory: join(import.meta.dir, "../../web/dist-plugin"),
	});
}
