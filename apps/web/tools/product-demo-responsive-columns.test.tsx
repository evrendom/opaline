import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
import { SessionAnalyticsSchema } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../src/app/ui/tooltip";
import { getModelBadgeTone } from "../src/features/dashboard/components/dashboard-model-brand";
import seed from "../src/features/demo/seed.json";
import { SessionsOverviewHeader } from "../src/features/sessions/components/sessions-overview-header";
import { SessionsOverviewRow } from "../src/features/sessions/components/sessions-overview-row";
import { SessionsOverviewSkeleton } from "../src/features/sessions/components/sessions-overview-skeleton";
import {
	getRepositoryLabel,
	getSessionBranchLabel,
	SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
} from "../src/features/sessions/components/sessions-overview-table-utils";

const ROW_SELECTOR = '[data-dashboard-grid-row-scope="session"]';
const SKILL_SELECTOR = "[data-session-overview-skill-tag]";
const OVERFLOW_SELECTOR = "[data-session-overview-skill-overflow-tag]";
const compactWholeNumberFormatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 0,
});

for (const { name, browserType, channel } of [
	{ name: "Chrome", browserType: chromium, channel: "chrome" },
	{ name: "WebKit", browserType: webkit, channel: undefined },
]) {
	test(`${name}: the unclicked demo shares spare table width while preserving compact minimums`, async () => {
		const browser = await browserType.launch({
			channel,
			headless: true,
			timeout: 15_000,
		});
		try {
			const page = await browser.newPage({ javaScriptEnabled: false });
			await page.goto("http://localhost:4600/product-demo/demo.html");
			for (const width of [390, 1024, 1512, 1728, 1920, 2036, 2560, 1512]) {
				await page.setViewportSize({ width, height: 907 });
				const header = page.locator('[data-slot="sessions-overview-header"]');
				for (const label of ["Input / Output", "API Cost"]) {
					expect(await header.getByText(label, { exact: true }).count()).toBe(
						0,
					);
				}
				const dateStyle = await page
					.locator("time")
					.first()
					.evaluate((element) => {
						const style = getComputedStyle(element);
						return {
							fontFamily: style.fontFamily,
							fontSize: style.fontSize,
							fontWeight: style.fontWeight,
							color: style.color,
							letterSpacing: style.letterSpacing,
						};
					});
				const containerWidth = await page
					.locator('[data-slot="sessions-overview-scroll-container"]')
					.evaluate((element) =>
						Number.parseFloat(getComputedStyle(element).width),
					);
				const limit =
					containerWidth >= 2200 ? 7 : containerWidth >= 1800 ? 5 : 3;
				const rowState = await page.locator(ROW_SELECTOR).evaluateAll(
					(elements, { skillSelector, overflowSelector }) =>
						elements.map((element) => ({
							href: element.getAttribute("href"),
							columnOrder: Array.from(element.children, (cell) =>
								cell.getAttribute("data-session-overview-column"),
							),
							skillText: element.querySelector(
								'[data-session-overview-column="skills"]',
							)?.textContent,
							dates: Array.from(element.querySelectorAll("time"), (date) => {
								const cell = date.parentElement;
								const avatar = element.querySelector(
									'[data-slot="session-member-profile-trigger"]',
								);
								const bounds = date.getBoundingClientRect();
								return {
									inTimeColumn:
										cell?.getAttribute("data-session-overview-column") ===
										"time",
									afterMember:
										cell?.previousElementSibling?.getAttribute(
											"data-session-overview-column",
										) === "user",
									lastColumn: cell === element.lastElementChild,
									rightOfAvatar: avatar
										? bounds.left > avatar.getBoundingClientRect().right
										: false,
									contained: cell
										? bounds.left >= cell.getBoundingClientRect().left &&
											bounds.right <= cell.getBoundingClientRect().right
										: false,
									rightInset: cell
										? cell.getBoundingClientRect().right - bounds.right
										: null,
								};
							}),
							members: Array.from(
								element.querySelectorAll(
									'[data-session-overview-column="user"]',
								),
								(cell) => {
									const avatar = cell.querySelector(
										'[data-slot="session-member-profile-trigger"]',
									);
									const signals = cell.querySelector(
										'[data-language-signal-speaker="member"]',
									);
									const avatarBounds = avatar?.getBoundingClientRect();
									const signalBounds = signals?.getBoundingClientRect();
									return {
										avatarWidth: avatarBounds?.width,
										avatarLast: avatar === cell.lastElementChild,
										rightInset: avatarBounds
											? cell.getBoundingClientRect().right - avatarBounds.right
											: null,
										hasSignals: Boolean(signals),
										signalsBeforeAvatar: signals?.nextElementSibling === avatar,
										gap:
											signalBounds && avatarBounds
												? avatarBounds.left - signalBounds.right
												: null,
										contained: signalBounds
											? signalBounds.left >= cell.getBoundingClientRect().left
											: true,
									};
								},
							),
							repositoryColumns: element.querySelectorAll(
								'[data-session-overview-column="repository"]',
							).length,
							repositoryMetadataStyles: Array.from(
								element.querySelectorAll(
									"[data-session-overview-repository-label], [data-session-overview-branch-label]",
								),
								(segment) => {
									const style = getComputedStyle(segment);
									return {
										color: style.color,
										fontFamily: style.fontFamily,
										fontSize: style.fontSize,
										fontWeight: style.fontWeight,
										lineHeight: style.lineHeight,
										letterSpacing: style.letterSpacing,
									};
								},
							),
							branches: Array.from(
								element.querySelectorAll(
									"[data-session-overview-branch-label]",
								),
								(label) => {
									const model = label.closest(
										'[data-session-overview-column="model"]',
									);
									const repository = label.previousElementSibling;
									const repositoryBounds = repository?.getBoundingClientRect();
									const bounds = label.getBoundingClientRect();
									return {
										text: label.textContent,
										maxWidth: getComputedStyle(label).maxWidth,
										truncated: label.scrollWidth > label.clientWidth + 1,
										afterRepository: repository?.hasAttribute(
											"data-session-overview-repository-label",
										),
										textAlign: getComputedStyle(label).textAlign,
										gap: repositoryBounds
											? bounds.left - repositoryBounds.right
											: null,
										width: bounds.width,
										contained: model
											? bounds.left >= model.getBoundingClientRect().left &&
												bounds.right <= model.getBoundingClientRect().right
											: false,
									};
								},
							),
							branchSeparators: element.querySelectorAll(
								"[data-session-overview-repository-branch-separator]",
							).length,
							repositoryNames: Array.from(
								element.querySelectorAll(
									"[data-session-overview-repository-label]",
								),
								(label) => {
									const model = label.closest(
										'[data-session-overview-column="model"]',
									);
									const modelName = label.previousElementSibling;
									const bounds = label.getBoundingClientRect();
									return {
										text: label.textContent,
										title: label.getAttribute("title"),
										modelGap: modelName
											? bounds.left - modelName.getBoundingClientRect().right
											: null,
										maxWidth: getComputedStyle(label).maxWidth,
										truncated: label.scrollWidth > label.clientWidth + 1,
										afterModelName: modelName?.hasAttribute(
											"data-session-overview-model-label",
										),
										width: bounds.width,
										contained: model
											? bounds.left >= model.getBoundingClientRect().left &&
												bounds.right <= model.getBoundingClientRect().right
											: false,
									};
								},
							),
							modelRepositorySeparators: element.querySelectorAll(
								"[data-session-overview-model-repository-separator]",
							).length,
							breadcrumbArrows: element.querySelectorAll(
								"[data-session-overview-repository-separator]",
							).length,
							folderIcons: element.querySelectorAll(
								"[data-session-overview-repository-icon]",
							).length,
							removedMetricElements: element.querySelectorAll(
								'[data-session-overview-column="tokens"], [data-session-overview-metric-tag]',
							).length,
							metrics: Array.from(
								element.querySelectorAll(
									'[data-session-overview-metric-value="cost"]',
								),
								(tag) => {
									const style = getComputedStyle(tag);
									const text = tag;
									const chart = element.querySelector(
										"[data-session-model-progress]",
									);
									const model = element.querySelector(
										'[data-session-overview-column="model"]',
									);
									const cell = element.querySelector(
										'[data-session-overview-column="cost"]',
									);
									return {
										costFirst:
											text.parentElement === cell &&
											cell === element.firstElementChild,
										chartInModel: model?.contains(chart),
										chartIsBackground: chart?.hasAttribute(
											"data-session-model-background",
										),
										chartWidth: chart?.getBoundingClientRect().width,
										chartColor: chart ? getComputedStyle(chart).color : null,
										chartCap: chart
											?.querySelector("path")
											?.getAttribute("stroke-linecap"),
										chartStrokeWidth: chart
											?.querySelector("path")
											?.getAttribute("stroke-width"),
										chartMask: chart ? getComputedStyle(chart).maskImage : null,
										chartChildren: chart?.children.length,
										modelLayers: chart?.parentElement?.children.length,
										costSeparator: text?.previousElementSibling?.textContent,
										costInsideCell:
											text && cell
												? text.getBoundingClientRect().right <=
													cell.getBoundingClientRect().right
												: false,
										costTooltip: text?.getAttribute(
											"data-session-overview-token-tooltip-label",
										),
										skillsFollowModel:
											model?.nextElementSibling?.getAttribute(
												"data-session-overview-column",
											) === "skills",
										beforeSignalsAndErrors: Array.from(
											model?.querySelectorAll(
												"[data-language-signal-speaker], [data-session-overview-error-tag]",
											) ?? [],
										).every((signal) =>
											Boolean(
												tag.compareDocumentPosition(signal) &
													Node.DOCUMENT_POSITION_FOLLOWING,
											),
										),
										insideMetricCell: cell
											? tag.parentElement === cell &&
												tag.getBoundingClientRect().right <=
													cell.getBoundingClientRect().right
											: false,
										style: {
											fontFamily: style.fontFamily,
											fontSize: style.fontSize,
											fontWeight: style.fontWeight,
											color: style.color,
											letterSpacing: style.letterSpacing,
										},
										background: style.backgroundColor,
										shadow: style.boxShadow,
										charts: element.querySelectorAll(
											"[data-session-model-progress]",
										).length,
										chartLabel: chart?.getAttribute("aria-label"),
										separator: tag.querySelector(
											"[data-session-overview-metric-separator]",
										)?.textContent,
										tokenLabel: tag.getAttribute(
											"data-session-overview-token-tooltip-label",
										),
										chartValue: Number(chart?.getAttribute("aria-valuenow")),
										values: Array.from(
											tag.querySelectorAll(
												"[data-session-overview-metric-value]",
											),
											(value) =>
												value.getAttribute(
													"data-session-overview-metric-value",
												),
										),
										textFits: text
											? text.scrollWidth <= text.clientWidth + 1
											: false,
										chartFits:
											chart && model
												? chart.getBoundingClientRect().top >=
														model.getBoundingClientRect().top &&
													chart.getBoundingClientRect().bottom <=
														model.getBoundingClientRect().bottom
												: false,
									};
								},
							),
							columns: getComputedStyle(element).gridTemplateColumns.split(" "),
							skills: Array.from(element.querySelectorAll(skillSelector))
								.filter((tag) => getComputedStyle(tag).display !== "none")
								.map((tag) => tag.textContent?.trim()),
							overflow: Array.from(element.querySelectorAll(overflowSelector))
								.filter((tag) => getComputedStyle(tag).display !== "none")
								.map((tag) => tag.textContent?.trim()),
						})),
					{
						skillSelector: SKILL_SELECTOR,
						overflowSelector: OVERFLOW_SELECTOR,
					},
				);
				expect(rowState).toHaveLength(seed.sessions.length);
				for (const row of rowState) {
					const session = seed.sessions.find((item) =>
						row.href?.includes(item.session_id),
					);
					assert(session);
					expect(row.columnOrder).toEqual([
						"cost",
						"model",
						"skills",
						"user",
						"time",
					]);
					expect(row.dates).toHaveLength(1);
					for (const date of row.dates) {
						expect(date.inTimeColumn).toBe(true);
						expect(date.afterMember).toBe(true);
						expect(date.lastColumn).toBe(true);
						expect(date.rightOfAvatar).toBe(true);
						expect(date.contained).toBe(true);
						expect(date.rightInset).toBeCloseTo(8, 1);
					}
					expect(row.members).toHaveLength(1);
					for (const member of row.members) {
						expect(member.avatarWidth).toBe(18);
						expect(member.avatarLast).toBe(true);
						expect(member.rightInset).toBeCloseTo(12, 1);
						expect(member.contained).toBe(true);
						if (member.hasSignals) {
							expect(member.signalsBeforeAvatar).toBe(true);
							expect(member.gap).toBeCloseTo(8, 1);
						} else {
							expect(member.gap).toBeNull();
						}
					}
					if (session.skills.length === 0) expect(row.skillText).toBe("");
					const parsedSession = SessionAnalyticsSchema.parse(session);
					const branchLabel = getSessionBranchLabel(parsedSession);
					expect(row.repositoryColumns).toBe(0);
					expect(row.repositoryNames).toHaveLength(1);
					expect(row.modelRepositorySeparators).toBe(0);
					for (const name of row.repositoryNames) {
						expect(name.text).toBe(getRepositoryLabel(parsedSession));
						expect(name.title).toBe(name.text);
						expect(name.modelGap).toBe(6);
						expect(name.afterModelName).toBe(true);
						expect(name.width).toBeGreaterThan(16);
						expect(name.contained).toBe(true);
						expect(name.maxWidth).toBe("none");
						if (width >= 1512) expect(name.truncated).toBe(false);
					}
					expect(row.branches).toHaveLength(branchLabel ? 1 : 0);
					expect(row.branchSeparators).toBe(0);
					for (const branch of row.branches) {
						assert(branchLabel);
						expect(branch.text).toBe(branchLabel);
						expect(branch.maxWidth).toBe("none");
						if (width >= 1512) expect(branch.truncated).toBe(false);
						expect(branch.afterRepository).toBe(true);
						expect(branch.textAlign).toBe("left");
						expect(branch.gap).toBe(6);
						expect(branch.width).toBeGreaterThan(16);
						expect(branch.contained).toBe(true);
					}
					// Interfere's hero metadata: 12/16px Inter, regular, gray-a11/a8.
					expect(
						row.repositoryMetadataStyles.map((style) => style.color),
					).toEqual(
						branchLabel
							? ["rgba(0, 0, 0, 0.608)", "rgba(0, 0, 0, 0.267)"]
							: ["rgba(0, 0, 0, 0.608)"],
					);
					for (const style of row.repositoryMetadataStyles) {
						expect(style.fontFamily).toContain("Inter");
						expect(style.fontSize).toBe("12px");
						expect(style.fontWeight).toBe("400");
						expect(style.lineHeight).toBe("16px");
						expect(style.letterSpacing).toBe("normal");
					}
					expect(row.breadcrumbArrows).toBe(0);
					expect(row.folderIcons).toBe(0);
					expect(row.removedMetricElements).toBe(0);
					expect(row.metrics).toHaveLength(1);
					for (const metric of row.metrics) {
						expect(metric.style).toEqual(dateStyle);
						expect(metric.background).toBe("rgba(0, 0, 0, 0)");
						expect(metric.shadow).toBe("none");
						expect(metric.charts).toBe(1);
						expect(metric.chartLabel).toContain("API cost");
						expect(metric.chartValue).toBe(
							Math.round((session.estimated_cost / seed.maxima.cost) * 100),
						);
						expect(metric.values).toEqual([]);
						expect(metric.costFirst).toBe(true);
						expect(metric.chartInModel).toBe(true);
						expect(metric.chartIsBackground).toBe(true);
						expect(metric.chartWidth).toBe(28);
						expect(metric.chartCap).toBe(
							session.estimated_cost > 0 ? "round" : undefined,
						);
						expect(metric.chartStrokeWidth).toBe(
							session.estimated_cost > 0 ? "3" : undefined,
						);
						expect(metric.chartMask).toContain("opaline-trace-fill.svg");
						expect(metric.chartChildren).toBe(
							session.estimated_cost > 0 ? 1 : 0,
						);
						expect(metric.modelLayers).toBe(2);
						const tone = getModelBadgeTone(session.model_used);
						if (tone.icon === "claude")
							expect(metric.chartColor).toBe("rgb(204, 125, 94)");
						if (tone.icon === "codex")
							expect(metric.chartColor).toBe("rgb(17, 17, 17)");
						expect(metric.costSeparator).toBeUndefined();
						expect(metric.costInsideCell).toBe(true);
						expect(metric.costTooltip).toBe(metric.tokenLabel);
						expect(metric.separator).toBeUndefined();
						expect(metric.tokenLabel).toBe(
							`Input: ${compactWholeNumberFormatter.format(session.input_tokens)} / Output: ${compactWholeNumberFormatter.format(session.output_tokens)}`,
						);
						expect(metric.skillsFollowModel).toBe(true);
						expect(metric.beforeSignalsAndErrors).toBe(true);
						expect(metric.insideMetricCell).toBe(true);
						expect(metric.textFits).toBe(true);
						expect(metric.chartFits).toBe(true);
					}
					expect(Number.parseFloat(row.columns[1])).toBeCloseTo(
						Math.min(960, 460 + Math.max(0, containerWidth - 1112) * 0.55),
						1,
					);
					expect(row.columns).toHaveLength(6);
					expect(Number.parseFloat(row.columns[0])).toBe(56);
					expect(Number.parseFloat(row.columns[4])).toBe(56);
					expect(Number.parseFloat(row.columns[3])).toBe(240);
					const tableWidth = Math.max(containerWidth, 1096);
					expect(Number.parseFloat(row.columns[2])).toBeCloseTo(
						tableWidth -
							112 -
							Number.parseFloat(row.columns[1]) -
							240 -
							Math.min(16, tableWidth - 1096),
						1,
					);
					expect(row.skills).toEqual(session.skills.slice(0, limit));
					expect(row.overflow).toEqual(
						session.skills.length > limit
							? [`+${session.skills.length - limit}`]
							: [],
					);
				}
				expect(await page.locator("html[data-demo-hydrated]").count()).toBe(0);
			}
		} finally {
			await browser.close();
		}
	}, 60_000);

	test(`${name}: 3/5/7 skill tiers, overflow tooltips and all grid parts align at exact container boundaries without JavaScript`, async () => {
		// Presentation fixtures exercise counts absent from the real preview, without
		// changing its seed or mocking the live API. Render the actual row components.
		const baseSession = SessionAnalyticsSchema.parse(seed.sessions[0]);
		const longRepositoryName =
			"a-very-long-repository-prefix-with-a-useful-name-at-the-end";
		const longBranchName =
			"feature/a-very-long-branch-prefix-with-a-useful-name-at-the-end";
		const skills = [
			"testing-bun",
			"typescript-standards",
			"vercel-react-best-practices",
			"a-deliberately-long-skill-name-that-must-truncate-without-wrapping",
			"make-responsive",
			"library-docs",
			"code-architecture",
			"diagnose",
		];
		const counts = [0, 2, 3, 4, 5, 6, 7, 8];
		const markup = renderToStaticMarkup(
			<TooltipProvider>
				<div
					data-responsive-fixture
					className="@container/sessions-overview"
					style={{ width: 1512, overflow: "auto" }}
				>
					<div className={SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME}>
						<SessionsOverviewHeader
							controls={null}
							onSort={() => {}}
							sort={{ key: "time", direction: "desc" }}
						/>
						<ul>
							{counts.map((count) => (
								<SessionsOverviewRow
									key={count}
									index={count}
									registerItem={() => {}}
									setHoverActiveIndex={() => {}}
									activeSessionId={null}
									avatarUrl={undefined}
									canOpenSession={undefined}
									getSessionHref={undefined}
									getSessionLinkState={undefined}
									maximumSessionCost={seed.maxima.cost}
									memberProfile={undefined}
									onSessionClick={undefined}
									userLabel="Layout fixture"
									session={{
										...baseSession,
										git_branch: longBranchName,
										repository_identity: {
											repoKey: `remote:github.com/example/${longRepositoryName}`,
											repoLabel: `example/${longRepositoryName}`,
											repoName: longRepositoryName,
											source: "remote",
											worktree: null,
										},
										model_used:
											count % 2 === 0 ? "gpt-5" : baseSession.model_used,
										input_tokens: count % 2 === 0 ? 654_300 : 654_700,
										output_tokens: count % 2 === 0 ? 1_600_000 : 1_400_000,
										estimated_cost: count % 2 === 0 ? 1.6 : 0.42,
										skills: skills.slice(0, count),
									}}
								/>
							))}
						</ul>
						<SessionsOverviewSkeleton />
					</div>
				</div>
			</TooltipProvider>,
		);
		const browser = await browserType.launch({
			channel,
			headless: true,
			timeout: 15_000,
		});
		try {
			const page = await browser.newPage({
				javaScriptEnabled: false,
				viewport: { width: 2560, height: 907 },
			});
			await page.goto("http://localhost:4600/product-demo/demo.html");
			// Keep the built product stylesheet and replace only this isolated test page.
			await page.locator("body").evaluate((element, html) => {
				element.innerHTML = html;
			}, markup);
			for (const width of [
				390, 1024, 1096, 1104, 1112, 1512, 1728, 1799, 1800, 1801, 2199, 2200,
				2201, 2560, 1512,
			]) {
				await page
					.locator("[data-responsive-fixture]")
					.evaluate((element, size) => {
						if (!(element instanceof HTMLElement))
							throw new Error("Expected the fixture container");
						element.style.width = `${size}px`;
					}, width);
				const limit = width >= 2200 ? 7 : width >= 1800 ? 5 : 3;
				const model = Math.min(960, 460 + Math.max(0, width - 1112) * 0.55);
				const tableWidth = Math.max(width, 1096);
				const trailing = Math.min(16, tableWidth - 1096);
				const skillsWidth = tableWidth - 112 - model - 240 - trailing;
				const expectedGrid = [56, model, skillsWidth, 240, 56, trailing];
				const grids = await page
					.locator("[data-responsive-fixture] .grid")
					.evaluateAll((elements) =>
						elements.map(
							(element) => getComputedStyle(element).gridTemplateColumns,
						),
					);
				expect(grids).toHaveLength(counts.length + 11); // header and ten skeleton rows
				for (const grid of grids) {
					const columns = grid.split(" ").map(Number.parseFloat);
					expect(columns).toHaveLength(expectedGrid.length);
					for (const [index, column] of columns.entries()) {
						expect(column).toBeCloseTo(expectedGrid[index], 1);
					}
				}
				for (const [index, count] of counts.entries()) {
					const row = page.locator(ROW_SELECTOR).nth(index);
					const repositoryLabel = row.locator(
						"[data-session-overview-repository-label]",
					);
					expect(await repositoryLabel.getAttribute("title")).toBe(
						longRepositoryName,
					);
					expect(await repositoryLabel.getAttribute("dir")).toBeNull();
					expect(
						await repositoryLabel.evaluate(
							(element) => getComputedStyle(element).direction,
						),
					).toBe("ltr");
					const branchLabel = row.locator(
						"[data-session-overview-branch-label]",
					);
					expect(await branchLabel.getAttribute("title")).toBe(longBranchName);
					if (width >= 2200) {
						expect(
							await repositoryLabel.evaluate(
								(element) => element.getBoundingClientRect().width,
							),
						).toBeGreaterThan(112);
						expect(
							await branchLabel.evaluate(
								(element) => element.getBoundingClientRect().width,
							),
						).toBeGreaterThan(160);
					}
					const truncation = await branchLabel.evaluate((element) => {
						const text = element.querySelector("bdi")?.firstChild;
						if (!(text instanceof Text)) throw new Error("Missing branch text");
						const bounds = element.getBoundingClientRect();
						const range = document.createRange();
						range.setStart(text, 0);
						range.setEnd(text, 1);
						const firstLetter = range.getBoundingClientRect();
						range.setStart(text, text.length - 1);
						range.setEnd(text, text.length);
						const lastLetter = range.getBoundingClientRect();
						return {
							overflow: getComputedStyle(element).textOverflow,
							overflowing: element.scrollWidth > element.clientWidth + 1,
							// WebKit collapses clipped glyph ranges; Chrome keeps their offscreen bounds.
							startClipped:
								firstLetter.width === 0 || firstLetter.left < bounds.left,
							endVisible:
								lastLetter.width > 0 &&
								lastLetter.left >= bounds.left &&
								lastLetter.right <= bounds.right + 1,
						};
					});
					expect(truncation.overflow).toBe("ellipsis");
					expect(truncation.startClipped).toBe(truncation.overflowing);
					expect(truncation.endVisible).toBe(true);
					if (width <= 1112) expect(truncation.overflowing).toBe(true);
					expect(
						await row.locator("[data-session-overview-metric-tag]").count(),
					).toBe(0);
					expect(
						await row
							.locator(
								'[data-session-overview-column="cost"] [data-session-overview-metric-value="cost"]',
							)
							.textContent(),
					).toBe(count % 2 === 0 ? "$2" : "42¢");
					expect(
						await row
							.locator('[data-session-overview-metric-value="cost"]')
							.getAttribute("data-session-overview-token-tooltip-label"),
					).toBe(
						count % 2 === 0
							? "Input: 654K / Output: 2M"
							: "Input: 655K / Output: 1M",
					);
					const tags = row.locator(`${SKILL_SELECTOR}:visible`);
					expect(await tags.allTextContents()).toEqual(
						skills.slice(0, Math.min(count, limit)),
					);
					const overflow = row.locator(`${OVERFLOW_SELECTOR}:visible`);
					expect(await overflow.allTextContents()).toEqual(
						count > limit ? [`+${count - limit}`] : [],
					);
					if (count > limit)
						expect(await overflow.getAttribute("title")).toBe(
							skills.slice(limit, count).join(", "),
						);
					const geometry = await row.evaluate((element) => {
						const cell = element.querySelector(
							'[data-session-overview-column="skills"]',
						);
						if (!cell) throw new Error("Missing skills cell");
						const bounds = cell.getBoundingClientRect();
						return {
							height: element.getBoundingClientRect().height,
							contained: Array.from(
								cell.querySelectorAll(
									"[data-session-overview-skill-tag], [data-session-overview-skill-overflow-tag]",
								),
							)
								.filter((tag) => getComputedStyle(tag).display !== "none")
								.every((tag) => {
									const rect = tag.getBoundingClientRect();
									return (
										rect.left >= bounds.left &&
										rect.right <= bounds.right &&
										rect.top >= bounds.top &&
										rect.bottom <= bounds.bottom
									);
								}),
						};
					});
					expect(geometry).toEqual({ height: 36, contained: true });
				}
			}
		} finally {
			await browser.close();
		}
	}, 60_000);
}
