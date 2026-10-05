import path from "node:path";
import { defineConfig } from "vitest/config";

// "server-only" throws unconditionally under plain Node (it only resolves to
// the no-op empty.js under the "react-server" export condition Next's RSC
// bundler sets) — alias it to that same empty.js so files that start with
// `import "server-only"` can be imported by tests.
export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
      "@": path.resolve(__dirname),
    },
  },
});
