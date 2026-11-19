declare const self: {
	addEventListener(type: "message", listener: () => void): void;
};

self.addEventListener("message", () => {
	throw new Error("Synthetic ingest worker crash");
});
