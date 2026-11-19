import { expect, test } from "bun:test";
import { expect as browserExpect, chromium, webkit } from "@playwright/test";

for (const { name, browserType, channel } of [
	{ name: "Chrome", browserType: chromium, channel: "chrome" },
	{ name: "WebKit", browserType: webkit, channel: undefined },
]) {
	test(`${name}: settings keep navigation fixed, headerless and persistently selected`, async () => {
		const browser = await browserType.launch({ channel, headless: true });
		let releaseWorkspaceModule = () => {};
		try {
			const page = await browser.newPage({
				viewport: { width: 1512, height: 907 },
			});
			const workspaceModuleGate = new Promise<void>((resolve) => {
				releaseWorkspaceModule = resolve;
			});
			await page.route("**/WorkspaceSettingsPage-*.js", async (route) => {
				await workspaceModuleGate;
				await route.continue();
			});

			const hydrationErrors: string[] = [];
			page.on("console", (message) => {
				if (
					message.type() === "error" &&
					/hydration|hydrating|did not match/i.test(message.text())
				) {
					hydrationErrors.push(message.text());
				}
			});
			// Keep the shared preview's development reload poller from interrupting
			// layout assertions when another workspace rebuilds the demo.
			await page.route("**/__preview/reload.js", (route) =>
				route.fulfill({ contentType: "text/javascript", body: "" }),
			);
			await page.goto("http://localhost:4600/home");
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			await page.locator("[data-instant-v2-dashboard-demo]").click();
			const frame = page.frameLocator("[data-instant-v2-product-iframe]");
			await frame.locator("html[data-demo-live]").waitFor();
			await frame.locator('[data-slot="dashboard-header"]').waitFor();
			await frame.locator('a[href="/settings"]').first().click();
			const layout = frame.locator('[data-slot="settings-layout"]');
			const sidebar = frame.locator('[data-slot="settings-sidebar"]');
			const content = frame.locator('[data-slot="settings-content"]');
			const nav = frame.getByRole("navigation", { name: "Settings sections" });
			await content.locator('[data-slot="settings-page-skeleton"]').waitFor();
			const skeletonSurfaces = await content
				.locator(".settings-section-surface")
				.evaluateAll((elements) =>
					elements.map((element) => {
						const style = getComputedStyle(element);
						return {
							width: style.width,
							height: style.height,
							radius: style.borderRadius,
							background: style.backgroundColor,
							shadow: style.boxShadow,
						};
					}),
				);
			expect(skeletonSurfaces).toHaveLength(2);
			await browserExpect(
				content.getByRole("heading", { level: 1 }),
			).toHaveText("Workspace");
			releaseWorkspaceModule();
			const workspaceGroup = content.getByRole("region", {
				name: "Workspace",
				exact: true,
			});
			await workspaceGroup
				.getByRole("textbox", { name: "Name", exact: true })
				.waitFor();
			await content
				.locator('[data-slot="settings-page-skeleton"]')
				.waitFor({ state: "hidden" });
			expect(
				await content
					.locator(".settings-section-surface")
					.evaluateAll((elements) =>
						elements.map((element) => {
							const style = getComputedStyle(element);
							return {
								width: style.width,
								height: style.height,
								radius: style.borderRadius,
								background: style.backgroundColor,
								shadow: style.boxShadow,
							};
						}),
					),
			).toEqual(skeletonSurfaces);
			for (const label of ["Members", "Pending invites", "Your role"]) {
				expect(await content.getByText(label, { exact: true }).count()).toBe(0);
			}
			expect(
				await content
					.locator(".workspace-settings-page")
					.evaluate((element) =>
						Number.parseFloat(getComputedStyle(element).width),
					),
			).toBe(640);
			const pageTitle = content.getByRole("heading", { level: 1 });
			await browserExpect(pageTitle).toHaveText("Workspace");
			expect(
				await pageTitle.evaluate(
					(element) => getComputedStyle(element).fontSize,
				),
			).toBe("24px");
			expect(
				await workspaceGroup
					.locator(".workspace-settings-group-rows")
					.evaluate((element) => ({
						radius: getComputedStyle(element).borderRadius,
						border: getComputedStyle(element).borderTopWidth,
					})),
			).toEqual({ radius: "10px", border: "1px" });
			const cardAppearance = await workspaceGroup
				.locator(".settings-section-surface")
				.evaluate((element) => ({
					background: getComputedStyle(element).backgroundColor,
					shadow: getComputedStyle(element).boxShadow,
				}));
			expect(cardAppearance.background).toBe("rgb(254, 254, 255)");
			expect(cardAppearance.shadow).not.toBe("none");
			expect(
				await workspaceGroup
					.locator(".workspace-settings-row")
					.first()
					.evaluate((element) => getComputedStyle(element).minHeight),
			).toBe("60px");

			const nameInput = workspaceGroup.getByRole("textbox", {
				name: "Name",
				exact: true,
			});
			const originalName = await nameInput.inputValue();
			expect(originalName.length).toBeGreaterThan(0);
			await nameInput.fill("Unsaved workspace name");
			await workspaceGroup
				.getByRole("button", { name: "Cancel", exact: true })
				.click();
			await browserExpect(nameInput).toHaveValue(originalName);
			await nameInput.focus();
			await nameInput.press("Escape");
			await nameInput.fill("Another unsaved name");
			await browserExpect(nameInput).toHaveValue("Another unsaved name");
			await workspaceGroup
				.getByRole("button", { name: "Cancel", exact: true })
				.click();
			await browserExpect(nameInput).toHaveValue(originalName);
			expect(
				await content
					.getByRole("region", {
						name: "Create another workspace",
						exact: true,
					})
					.count(),
			).toBe(0);
			expect(
				await content
					.getByRole("button", { name: "Create workspace", exact: true })
					.count(),
			).toBe(0);
			await content
				.getByRole("button", { name: "Delete workspace", exact: true })
				.click();
			const deleteDialog = frame.getByRole("dialog", {
				name: "Delete workspace",
				exact: true,
			});
			await deleteDialog.waitFor();
			await browserExpect(
				deleteDialog.getByRole("button", {
					name: "Delete workspace",
					exact: true,
				}),
			).toBeDisabled();
			await deleteDialog
				.getByRole("button", { name: "Cancel", exact: true })
				.click();
			await deleteDialog.waitFor({ state: "hidden" });

			for (const width of [1512, 1024, 768, 1512]) {
				await page.setViewportSize({ width, height: 907 });
				await sidebar.waitFor({ state: "visible" });
				expect(
					await frame.locator('[data-slot="dashboard-header"]').count(),
				).toBe(0);
				expect(await nav.getByRole("link").allTextContents()).toEqual([
					"Workspace",
					"Members",
					"Account",
				]);
				expect(await layout.getByRole("tablist").count()).toBe(0);
				const geometry = await layout.evaluate((element) => {
					const sidebar = element.querySelector(
						'[data-slot="settings-sidebar"]',
					);
					const content = element.querySelector(
						'[data-slot="settings-content"]',
					);
					const nav = sidebar?.querySelector("nav");
					const window = element.closest(".dashboard-01-window");
					if (!sidebar || !content || !nav || !window)
						throw new Error("Missing settings window layout");
					const sideBounds = sidebar.getBoundingClientRect();
					const contentBounds = content.getBoundingClientRect();
					const windowBounds = window.getBoundingClientRect();
					const links = Array.from(nav.querySelectorAll("a"));
					return {
						width: Number.parseFloat(getComputedStyle(sidebar).width),
						besideContent: sideBounds.right < contentBounds.left,
						insideWindow:
							sideBounds.left >= windowBounds.left &&
							contentBounds.right <= windowBounds.right,
						vertical: links.every(
							(link, index) =>
								index === 0 ||
								link.getBoundingClientRect().top >
									links[index - 1].getBoundingClientRect().bottom,
						),
						sidebarBackground: getComputedStyle(sidebar).backgroundColor,
						navBackground: getComputedStyle(nav).backgroundColor,
						sidebarBorder: getComputedStyle(sidebar).borderRightWidth,
						sidebarShadow: getComputedStyle(sidebar).boxShadow,
						contentScrolls: getComputedStyle(content).overflowY === "auto",
						contained: element.scrollHeight <= element.clientHeight,
						noOverflow:
							element.scrollWidth <= element.clientWidth &&
							content.scrollWidth <= content.clientWidth,
					};
				});
				expect(geometry).toEqual({
					width: 168,
					besideContent: true,
					insideWindow: true,
					vertical: true,
					sidebarBackground: "rgba(0, 0, 0, 0)",
					navBackground: "rgba(0, 0, 0, 0)",
					sidebarBorder: "0px",
					sidebarShadow: "none",
					contentScrolls: true,
					contained: true,
					noOverflow: true,
				});
			}

			await nav.getByRole("link", { name: "Members", exact: true }).hover();
			await nav.locator('[data-slot="fluid-hover-highlight"]').waitFor();
			await nav
				.locator("a[data-fluid-hover-active]")
				.filter({ hasText: "Members" })
				.waitFor();
			const hoverFill = await nav
				.locator('[data-slot="fluid-hover-highlight"]')
				.evaluate((element) => getComputedStyle(element).backgroundColor);
			expect(hoverFill).not.toBe("rgba(0, 0, 0, 0)");
			const workspace = nav.getByRole("link", {
				name: "Workspace",
				exact: true,
			});
			expect(
				await workspace.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).toBe(hoverFill);
			await nav.getByRole("link", { name: "Members", exact: true }).click();
			await browserExpect(pageTitle).toHaveText("Members");
			await content
				.getByRole("button", { name: "Create invite link", exact: true })
				.waitFor();
			await content
				.locator('[data-slot="settings-page-skeleton"]')
				.waitFor({ state: "hidden" });
			expect(await content.locator(".settings-section-surface").count()).toBe(
				4,
			);
			const inviteGroup = content.getByRole("region", {
				name: "Invite member",
				exact: true,
			});
			await browserExpect(
				inviteGroup.getByRole("button", { name: "Send invite", exact: true }),
			).toBeDisabled();
			await inviteGroup
				.getByRole("textbox", { name: "Email", exact: true })
				.fill("unsubmitted@example.com");
			await browserExpect(
				inviteGroup.getByRole("button", { name: "Send invite", exact: true }),
			).toBeEnabled();
			const inviteRole = inviteGroup.getByRole("combobox", {
				name: "Role",
				exact: true,
			});
			await inviteRole.click();
			await frame.getByRole("option", { name: "Admin", exact: true }).click();
			await browserExpect(inviteRole).toHaveText("Admin");
			await inviteGroup
				.getByRole("textbox", { name: "Email", exact: true })
				.fill("");
			const linkGroup = content.getByRole("region", {
				name: "Invite link",
				exact: true,
			});
			await browserExpect(
				linkGroup.getByRole("button", {
					name: "Create invite link",
					exact: true,
				}),
			).toBeEnabled();
			await browserExpect(
				linkGroup.getByRole("button", {
					name: "Revoke existing links",
					exact: true,
				}),
			).toBeEnabled();
			expect(await content.getByRole("table").count()).toBe(0);
			expect(
				await content
					.getByRole("list", { name: "Workspace members", exact: true })
					.getByRole("listitem")
					.count(),
			).toBe(3);
			expect(
				await content
					.locator(".workspace-settings-member-copy > :first-child")
					.allTextContents(),
			).toEqual(["Marc", "Rafa", "Evren"]);
			await browserExpect(
				content
					.getByRole("list", { name: "Workspace members", exact: true })
					.getByRole("listitem")
					.filter({ has: frame.getByText("Evren", { exact: true }) })
					.locator(".workspace-settings-status"),
			).toHaveText("owner");
			await browserExpect(
				content.getByRole("combobox", { name: "Role for Marc", exact: true }),
			).toHaveText("Admin");
			expect(
				await inviteRole.evaluate((element) => {
					const style = getComputedStyle(element);
					return {
						height: style.height,
						radius: style.borderRadius,
						font: style.fontSize,
					};
				}),
			).toEqual({ height: "32px", radius: "6px", font: "13px" });

			await content.getByText("Invite member", { exact: true }).waitFor();
			await browserExpect(pageTitle).toHaveText("Members");
			await content.hover();
			await content.evaluate((element) => {
				element.scrollTop = 0;
			});
			expect(
				await content.evaluate(
					(element) => element.scrollHeight > element.clientHeight,
				),
			).toBe(true);
			const sidebarTop = await sidebar.evaluate(
				(element) => element.getBoundingClientRect().top,
			);
			await page.mouse.wheel(0, 500);
			await browserExpect
				.poll(() => content.evaluate((element) => element.scrollTop))
				.toBeGreaterThan(0);
			expect(
				await sidebar.evaluate(
					(element) => element.getBoundingClientRect().top,
				),
			).toBe(sidebarTop);
			await content.evaluate((element) => {
				element.scrollTop = 0;
			});
			expect(
				await content
					.locator(".settings-section-surface")
					.first()
					.evaluate((element) => ({
						background: getComputedStyle(element).backgroundColor,
						shadow: getComputedStyle(element).boxShadow,
					})),
			).toEqual(cardAppearance);
			expect(
				await nav
					.getByRole("link", { name: "Members", exact: true })
					.getAttribute("aria-current"),
			).toBe("page");
			await content.hover();
			expect(
				await nav
					.getByRole("link", { name: "Members", exact: true })
					.evaluate((element) => getComputedStyle(element).backgroundColor),
			).toBe(hoverFill);
			expect(
				await workspace.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).toBe("rgba(0, 0, 0, 0)");
			const account = nav.getByRole("link", { name: "Account", exact: true });
			await account.focus();
			await account.press("Enter");
			await browserExpect(pageTitle).toHaveText("Account");
			await content
				.getByRole("region", { name: "Profile", exact: true })
				.getByRole("textbox", { name: "Email", exact: true })
				.waitFor();
			await content
				.locator('[data-slot="settings-page-skeleton"]')
				.waitFor({ state: "hidden" });
			expect(await content.locator(".settings-section-surface").count()).toBe(
				4,
			);
			expect(
				await content.getByRole("heading", { level: 2 }).allTextContents(),
			).toEqual([
				"Profile",
				"Linked accounts",
				"Workspace invitations",
				"Danger zone",
			]);
			const profile = content.getByRole("region", {
				name: "Profile",
				exact: true,
			});
			await browserExpect(
				profile.getByRole("textbox", { name: "Name", exact: true }),
			).toHaveValue("Evren");
			await browserExpect(
				profile.getByRole("textbox", { name: "Name", exact: true }),
			).toHaveAttribute("readonly", "");
			await browserExpect(
				profile.getByRole("textbox", { name: "Email", exact: true }),
			).toHaveAttribute("readonly", "");
			await browserExpect(
				profile.getByRole("button", { name: "Sign out", exact: true }),
			).toBeEnabled();
			expect(await profile.locator(".workspace-settings-row").count()).toBe(4);
			expect(
				await content
					.getByRole("region", { name: "Linked accounts", exact: true })
					.locator(".workspace-settings-row")
					.count(),
			).toBe(3);
			await content
				.getByRole("button", { name: "Delete account", exact: true })
				.click();
			const accountDialog = frame.getByRole("dialog", {
				name: "Delete account",
				exact: true,
			});
			await accountDialog.waitFor();
			await browserExpect(
				accountDialog.getByRole("button", {
					name: "Delete account",
					exact: true,
				}),
			).toBeDisabled();
			await accountDialog
				.getByRole("button", { name: "Cancel", exact: true })
				.click();
			await accountDialog.waitFor({ state: "hidden" });

			await content.getByText("Profile", { exact: true }).waitFor();
			await browserExpect(pageTitle).toHaveText("Account");
			expect(
				await content
					.locator(".settings-section-surface")
					.first()
					.evaluate((element) => ({
						background: getComputedStyle(element).backgroundColor,
						shadow: getComputedStyle(element).boxShadow,
					})),
			).toEqual(cardAppearance);
			expect(await account.getAttribute("aria-current")).toBe("page");
			await content.hover();
			expect(
				await account.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).toBe(hoverFill);

			for (const width of [390, 540]) {
				await page.setViewportSize({ width, height: 907 });
				await sidebar.waitFor({ state: "hidden" });
				const picker = frame.getByRole("combobox", {
					name: "Settings section",
				});
				await picker.waitFor();
				expect(
					await frame.locator('[data-slot="dashboard-header"]').count(),
				).toBe(0);
				expect(
					await picker.evaluate(
						(element) => element.getBoundingClientRect().height,
					),
				).toBe(48);
				await picker.click();
				await frame
					.getByRole("option", { name: "Members", exact: true })
					.click();
				await content.getByText("Invite member", { exact: true }).waitFor();
				expect(await picker.textContent()).toContain("Members");
				await content
					.locator('[data-slot="settings-page-skeleton"]')
					.waitFor({ state: "hidden" });
				expect(
					await content.evaluate(
						(element) => element.scrollWidth <= element.clientWidth,
					),
				).toBe(true);
				expect(
					await content
						.getByRole("region", { name: "Invite member", exact: true })
						.getByRole("textbox", { name: "Email", exact: true })
						.evaluate((element) => {
							const style = getComputedStyle(element);
							return { height: style.height, font: style.fontSize };
						}),
				).toEqual({ height: "48px", font: "16px" });

				expect(
					await layout.evaluate(
						(element) => element.scrollWidth <= element.clientWidth,
					),
				).toBe(true);
				await picker.click();
				await frame
					.getByRole("option", { name: "Account", exact: true })
					.click();
				await content.getByText("Profile", { exact: true }).waitFor();
			}
			await page.setViewportSize({ width: 1512, height: 907 });
			await sidebar.waitFor();
			expect(await account.getAttribute("aria-current")).toBe("page");
			await frame.locator('a[href="/session"]').first().click();
			await frame.locator('[data-slot="dashboard-header"]').waitFor();
			expect(hydrationErrors).toEqual([]);
		} finally {
			releaseWorkspaceModule();
			await browser.close();
		}
	}, 90_000);
}
