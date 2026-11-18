export class ReusableWorkers {
	private readonly idle: Worker[] = [];

	constructor(
		private readonly create: () => Worker,
		private readonly keep: number,
	) {}

	take(): Worker {
		const worker = this.idle.pop();
		if (worker) {
			worker.ref();
			return worker;
		}
		return this.create();
	}

	give(worker: Worker): void {
		if (this.idle.length >= this.keep) {
			worker.terminate();
			return;
		}
		worker.unref();
		this.idle.push(worker);
	}

	close(): void {
		for (const worker of this.idle.splice(0)) worker.terminate();
	}
}
