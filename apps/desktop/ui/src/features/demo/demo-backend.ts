import {
	createFixtureFetch,
	type DemoFetch,
	type DemoFixtureIndex,
	servesFromFixtures,
} from "./demo-fixtures";
import { answerLive } from "./demo-live";

const FIXTURES_URL = `${import.meta.env.BASE_URL}fixtures/`;

let installed = false;
let index: Promise<DemoFixtureIndex> | null = null;
const files = new Map<string, Promise<string>>();

export function installDemoBackend(): void {
	if (installed) return;
	installed = true;
	const network: DemoFetch = window.fetch.bind(window);
	const loadIndex = () => {
		index ??= network(`${FIXTURES_URL}index.json`).then((response) => {
			if (!response.ok) throw new Error("The demo data could not load.");
			return response.json() as Promise<DemoFixtureIndex>;
		});
		index.catch(() => {
			index = null;
		});
		return index;
	};
	const readFile = (file: string) => {
		let text = files.get(file);
		if (!text) {
			text = network(`${FIXTURES_URL}${file}`).then(async (response) => {
				if (!response.ok) throw new Error("The demo data could not load.");
				const bytes = new Uint8Array(await response.arrayBuffer());
				if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
					return new TextDecoder().decode(bytes);
				return new Response(
					new Blob([bytes])
						.stream()
						.pipeThrough(new DecompressionStream("gzip")),
				).text();
			});
			text.catch(() => files.delete(file));
			files.set(file, text);
		}
		return text;
	};
	let answer: DemoFetch | null = null;
	const demoFetch: DemoFetch = async (input, init) => {
		const url = new URL(
			input instanceof Request ? input.url : String(input),
			window.location.href,
		);
		if (
			url.origin !== window.location.origin ||
			!servesFromFixtures(url.pathname)
		)
			return network(input, init);
		answer ??= createFixtureFetch(
			await loadIndex(),
			readFile,
			network,
			() => window.location.origin,
		);
		const recorded = answer;
		return (
			(await answerLive(url.pathname, input, init, () =>
				recorded(input, init),
			)) ?? recorded(input, init)
		);
	};
	Object.defineProperty(window, "fetch", {
		configurable: true,
		writable: true,
		value: demoFetch,
	});
}

export function prepareDemoBackend(): Promise<unknown> {
	installDemoBackend();
	return window.fetch(
		new URL("/api/demo/auth/get-session", window.location.href),
	);
}
