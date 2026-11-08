// The search model in a worker of its own. Loading ONNX Runtime and the 35 MB model
// takes one to three seconds on an iPad; here that happens beside the library engine
// instead of inside it, so the first searches typed after launch are answered at once.
// The engine reaches this worker over a MessageChannel the app hands to both
// (engine.js attachModel): load, then embed, one query at a time.
import * as Sem from "./semantic.js";

let port = null;
self.onmessage = (e) => {
  if (e.data && e.data.port) { port = e.data.port; port.onmessage = onCall; }
};
async function onCall(e) {
  const { id, method, params } = e.data || {};
  try {
    if (method === "load") {
      await Sem.load({ base: params.base, onProgress: (p) => port.postMessage({ id, progress: p }) });
      port.postMessage({ id, result: { ready: true } });
    } else if (method === "embed") {
      const v = await Sem.embed(String(params.text || ""), { query: true });
      port.postMessage({ id, result: v.buffer }, [v.buffer]);
    } else if (method === "status") {
      port.postMessage({ id, result: { ready: Sem.ready(), failed: Sem.failed() ? String(Sem.failed().message || Sem.failed()) : null } });
    } else {
      throw new Error(`unknown method ${method}`);
    }
  } catch (err) {
    port.postMessage({ id, error: { message: err?.message || String(err) } });
  }
}
