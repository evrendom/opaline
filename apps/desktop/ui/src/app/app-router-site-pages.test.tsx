import type { ReactElement, ReactNode } from "react";
import { createRoutesFromChildren, type RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { getSitePageRoute } from "../../../server/src/lib/site-page-route";
import { AppRouterRoutes } from "./AppRouter";

const WORKSPACE_SLUG = "acme";
const SERVED_BY_OTHER_REWRITES = new Set(["/"]);

function joinPath(parent: string, child: string | undefined) {
	if (!child) return parent;
	if (child.startsWith("/")) return child;
	return `${parent.replace(/\/$/u, "")}/${child}`;
}

function collectPaths(routes: RouteObject[], parent = ""): string[] {
	return routes.flatMap((route) => {
		const path = joinPath(parent, route.path);
		const own = route.path || route.index ? [path] : [];
		return [...own, ...collectPaths(route.children ?? [], path)];
	});
}

function expandParams(path: string): string[] {
	let variants = [""];
	for (const segment of path.split("/").filter(Boolean)) {
		const optional = segment.endsWith("?");
		const name = optional ? segment.slice(0, -1) : segment;
		const value = name === ":workspaceSlug" ? WORKSPACE_SLUG : name;
		const concrete = value.startsWith(":") ? "param" : value;
		variants = variants.flatMap((variant) =>
			optional
				? [variant, `${variant}/${concrete}`]
				: [`${variant}/${concrete}`],
		);
	}
	return variants.map((variant) => variant || "/");
}

function appRouterPaths() {
	const element = AppRouterRoutes({
		rootRedirectTarget: null,
	}) as ReactElement<{
		children: ReactNode;
	}>;
	const routes = createRoutesFromChildren(element.props.children);
	return [...new Set(collectPaths(routes).flatMap(expandParams))]
		.filter((path) => !path.includes("*"))
		.filter((path) => !SERVED_BY_OTHER_REWRITES.has(path))
		.sort();
}

describe("AppRouter direct loads", () => {
	it("finds the router's routes", () => {
		const paths = appRouterPaths();
		expect(paths).toContain("/compass");
		expect(paths).toContain(`/${WORKSPACE_SLUG}/reports/param`);
		expect(paths.length).toBeGreaterThan(40);
	});

	it.each(
		appRouterPaths(),
	)("serves %s as an app page on a fresh load", (path) => {
		const expected = path.startsWith(`/${WORKSPACE_SLUG}`)
			? { kind: "workspace", slug: WORKSPACE_SLUG }
			: { kind: "app" };
		expect(getSitePageRoute(path)).toEqual(expected);
	});
});
