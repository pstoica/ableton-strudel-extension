// Browser-only bundle: registers note(), slow(), etc. on globalThis via evalScope.
// note() and most pattern functions live in @strudel/core — must pass core to evalScope too.
import { evalScope } from "@strudel/core";
import * as core  from "@strudel/core";
import * as mini  from "@strudel/mini";
import * as tonal from "@strudel/tonal";

(async () => {
  await evalScope(
    Promise.resolve(core),
    Promise.resolve(mini),
    Promise.resolve(tonal),
  );
  (window as unknown as Record<string, unknown>).__strudelReady = true;
  (window as unknown as Record<string, unknown>).__strudelNote = typeof (globalThis as Record<string,unknown>).note;
  window.dispatchEvent(new Event("strudelready"));
})();
