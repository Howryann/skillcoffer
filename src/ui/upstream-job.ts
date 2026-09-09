import { Worker } from "node:worker_threads";
import { Store } from "../store.js";
import type { UpstreamProgress } from "../upstream.js";

/** Keep blocking Git work off the HTTP event loop. Repeated starts share one job. */
export class UpstreamJob {
  progress: UpstreamProgress = { running: false, completed: 0, total: 0 };
  private worker?: Worker;

  constructor(private store: Store) {}

  start(): UpstreamProgress {
    if (this.worker) return this.progress;
    this.progress = {
      running: true, completed: 0,
      total: this.store.list().filter(m => m.upstream?.remote === "github").length,
    };
    try {
      const worker = new Worker(new URL("./upstream-worker.js", import.meta.url), {
        workerData: { home: this.store.home },
      });
      this.worker = worker;
      worker.on("message", (progress: UpstreamProgress) => { this.progress = progress; });
      worker.on("error", (error) => {
        this.progress = { ...this.progress, running: false, error: error.message };
      });
      worker.on("exit", (code) => {
        this.worker = undefined;
        this.progress = {
          ...this.progress, running: false,
          ...(code && !this.progress.error ? { error: "检查中断，请重试。" } : {}),
        };
      });
    } catch (error) {
      this.progress = { ...this.progress, running: false, error: String(error) };
    }
    return this.progress;
  }
}
