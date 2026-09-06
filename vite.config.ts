import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/** Short commit hash for the footer: CI's GITHUB_SHA, else the local checkout, else "dev". */
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  // GitHub Pages serves the project under /schema-explorer/. Set BASE_PATH=/ to build for a root host.
  base: process.env.BASE_PATH ?? "/schema-explorer/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT__: JSON.stringify(commit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10))
  },
  build: {
    target: "es2022",
    sourcemap: true
  },
  worker: {
    // The embedding worker is a module worker with its own chunk graph.
    format: "es"
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
    testTimeout: 15_000
  }
});
