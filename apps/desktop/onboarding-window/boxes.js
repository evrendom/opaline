(() => {
	const LINE = 19;
	const REPOSITORY_HUES = [10, 35, 60, 85, 110, 135, 160, 185, 210, 235];

	const compact = (value) =>
		value >= 1e9 ? `${(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}K` : String(Math.round(value));

	const hours = (seconds) => (seconds >= 36000 ? `${Math.round(seconds / 3600)} h` : seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : `${Math.max(1, Math.round(seconds / 60))} min`);

	const MEASURES = {
		sessions: {
			value: () => 1,
			tile: (total) => `${total.toLocaleString("en-US")} sessions`,
			figure: (total) => total.toLocaleString("en-US"),
			unit: " sessions",
			note: "The last 30 days, per repo.",
		},
		tokens: {
			value: (session) => session.tokens,
			tile: (total) => `${compact(total)} tokens`,
			figure: (total) => compact(total),
			unit: " tokens",
			note: "Everything your agents read and wrote, cache included, per repo.",
		},
		time: {
			value: (session) => session.seconds,
			tile: (total) => hours(total),
			figure: (total) => hours(total),
			unit: " of agent time",
			note: "How long your agents were working, per repo.",
		},
	};

	function squarify(items, width, height) {
		const total = items.reduce((sum, item) => sum + item.value, 0);
		if (total <= 0) return [];
		const queue = [...items].sort((a, b) => b.value - a.value).map((item) => ({ item, area: (item.value / total) * width * height }));
		const box = { left: 0, top: 0, width, height };
		const cells = [];
		const worst = (areas, side) => {
			const sum = areas.reduce((acc, area) => acc + area, 0);
			return Math.max((side * side * Math.max(...areas)) / (sum * sum), (sum * sum) / (side * side * Math.min(...areas)));
		};
		const lay = (strip) => {
			const sum = strip.reduce((acc, entry) => acc + entry.area, 0);
			if (box.width >= box.height) {
				const across = sum / box.height;
				let top = box.top;
				for (const { item, area } of strip) {
					cells.push({ item, x: box.left, y: top, w: across, h: area / across });
					top += area / across;
				}
				box.left += across;
				box.width -= across;
			} else {
				const down = sum / box.width;
				let left = box.left;
				for (const { item, area } of strip) {
					cells.push({ item, x: left, y: box.top, w: area / down, h: down });
					left += area / down;
				}
				box.top += down;
				box.height -= down;
			}
		};
		let strip = [];
		for (const entry of queue) {
			const side = Math.min(box.width, box.height);
			const next = [...strip, entry];
			if (strip.length && worst(next.map((each) => each.area), side) > worst(strip.map((each) => each.area), side)) {
				lay(strip);
				strip = [entry];
			} else strip = next;
		}
		if (strip.length) lay(strip);
		return cells;
	}

	function repos(sessions, limit) {
		const groups = new Map();
		for (const session of sessions) {
			if (!session.folder) continue;
			if (!groups.has(session.folder)) groups.set(session.folder, []);
			groups.get(session.folder).push(session);
		}
		return [...groups.entries()]
			.map(([name, list]) => ({ name, sessions: list }))
			.sort((a, b) => b.sessions.length - a.sessions.length)
			.slice(0, Math.max(1, limit))
			.map((repo, rank) => ({ ...repo, hue: REPOSITORY_HUES[rank] }));
	}

	function mount(view, read, initial = "sessions") {
		const host = view.querySelector("[data-boxes]");
		const figure = view.querySelector("[data-title-figure]");
		const unit = view.querySelector("[data-title-unit]");
		const note = view.querySelector("[data-reading-note]");
		const stage = document.createElement("div");
		stage.className = "repo-boxes";
		host.append(stage);
		const tiles = new Map();
		let measure = initial;
		let shown = "";

		function tileFor(repo) {
			if (tiles.has(repo.name)) return tiles.get(repo.name);
			const chroma = repo.hue === undefined ? 0 : 0.16;
			const tile = document.createElement("div");
			tile.className = "repo-box";
			tile.style.setProperty("--tint", `oklch(0.66 ${chroma} ${repo.hue ?? 0})`);
			tile.style.animationDelay = `${tiles.size * 45}ms`;
			tile.innerHTML = '<span class="repo-box-body"><span class="repo-box-name"></span><span class="repo-box-count"></span></span>';
			stage.append(tile);
			tiles.set(repo.name, tile);
			return tile;
		}

		function layout() {
			const feed = read();
			const box = host.getBoundingClientRect();
			const header = view.querySelector(".reading-center").getBoundingClientRect();
			const top = Math.round(header.bottom - box.top) + 24;
			const key = `${measure}:${feed.done}:${feed.sessions.length}:${feed.count}:${feed.gap}:${Math.round(box.width)}x${Math.round(box.height)}:${top}`;
			if (!feed.done || !box.width || key === shown) return;
			shown = key;
			const spec = MEASURES[measure];
			const total = feed.sessions.reduce((sum, session) => sum + spec.value(session), 0);
			figure.textContent = spec.figure(total);
			unit.textContent = spec.unit;
			note.textContent = spec.note;
			const list = repos(feed.sessions, feed.count).map((repo) => ({ repo, value: repo.sessions.reduce((sum, session) => sum + spec.value(session), 0) }));
			const gap = feed.gap;
			const area = { x: 40, y: top, w: box.width - 80 + gap, h: box.height - top - 28 + gap };
			const floor = Math.max(...list.map((entry) => entry.value)) * 0.004;
			const cells = squarify(list.map((entry) => ({ ...entry, value: Math.max(entry.value, floor) })), area.w, area.h);
			for (const { item, x, y, w, h } of cells) {
				const tile = tileFor(item.repo);
				const left = Math.round(area.x + x);
				const top = Math.round(area.y + y);
				const width = Math.max(0, Math.round(area.x + x + w) - left - gap);
				const height = Math.max(0, Math.round(area.y + y + h) - top - gap);
				const side = Math.min(width, height);
				const padX = Math.min(12, Math.max(3, Math.floor(width * 0.16)));
				const padY = Math.min(10, Math.max(3, Math.floor(height * 0.16)));
				Object.assign(tile.style, {
					left: `${left}px`,
					top: `${top}px`,
					width: `${width}px`,
					height: `${height}px`,
					borderRadius: `${Math.min(12, Math.floor(side / 3))}px`,
					"--pad-x": `${padX}px`,
					"--pad-y": `${padY}px`,
				});
				const room = height - 2 - 2 * padY;
				const named = width >= 56 && room >= LINE;
				const small = width < 120 || room < 2 * LINE + 4;
				const amount = spec.tile(item.value);
				tile.querySelector(".repo-box-name").textContent = !named ? "" : small ? `${item.repo.name} · ${amount}` : item.repo.name;
				tile.querySelector(".repo-box-count").textContent = small ? "" : amount;
			}
		}

		const observer = new ResizeObserver(layout);
		observer.observe(host);
		const timer = setInterval(layout, 250);
		layout();

		return {
			update: layout,
			enter() {
				[...tiles.values()].forEach((tile, index) => {
					tile.style.animation = "none";
					tile.getBoundingClientRect();
					tile.style.animation = "";
					tile.style.animationDelay = `${260 + index * 40}ms`;
				});
			},
			show(next) {
				measure = next;
				layout();
			},
			destroy() {
				clearInterval(timer);
				observer.disconnect();
				stage.remove();
			},
		};
	}

	window.repoBoxes = { mount };
})();
