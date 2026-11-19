import { createServer } from "node:net";

export function findFreePort(host = "127.0.0.1"): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen({ host, port: 0 }, () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() =>
				port ? resolve(port) : reject(new Error("No free port")),
			);
		});
	});
}

export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.unref();
		server.once("error", () => resolve(false));
		server.listen({ host, port, exclusive: true }, () => {
			server.close(() => resolve(true));
		});
	});
}
