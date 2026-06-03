// Browser-only bundle: registers note(), slow(), etc. on globalThis via evalScope.
// Built by esbuild for browser target — no CDN, no network dependency in the webview.
import { evalScope } from "@strudel/core";
import * as mini  from "@strudel/mini";
import * as tonal from "@strudel/tonal";

(async () => {
  await evalScope(Promise.resolve(mini), Promise.resolve(tonal));
  (window as unknown as Record<string, unknown>).__strudelReady = true;
  window.dispatchEvent(new Event("strudelready"));
})();
