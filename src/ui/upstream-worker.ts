import { parentPort, workerData } from "node:worker_threads";
import { Store } from "../store.js";
import { checkAllUpstreams } from "../upstream.js";

checkAllUpstreams(new Store(workerData.home), (progress) => parentPort?.postMessage(progress));
