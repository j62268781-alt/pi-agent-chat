#!/usr/bin/env node
//
// Type-check the bundled pi extensions under `pi-extensions/`.
//
// These files are loaded by the `pi` CLI at runtime (no ahead-of-time build),
// but they import types from the pi packages declared as dependencies of this
// project. There is no local package.json for `pi-extensions/`, so the
// committed `tsconfig.pi-extensions.json` relies on every package resolving
// from the root `node_modules`.
//
// Usage:
//   node scripts/typecheck-pi-extensions.mjs                 # check all
//   node scripts/typecheck-pi-extensions.mjs pi-extensions/btw.ts
//
// Cross-platform replacement for the original bash `typecheck.sh`.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(projectRoot, "tsconfig.pi-extensions.json");
const scratchConfig = join(projectRoot, ".tsconfig.pi-extensions-check.json");

if (!existsSync(configPath)) {
  console.error(`missing ${configPath}`);
  process.exit(1);
}

const localTsgo = join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsgo.cmd" : "tsgo",
);
const tsgo = existsSync(localTsgo) ? localTsgo : "tsgo";

const targets = process.argv.slice(2);
let effectiveConfig = configPath;

if (targets.length > 0) {
  const files = targets.map((target) => JSON.stringify(resolve(projectRoot, target)));
  writeFileSync(
    scratchConfig,
    `${JSON.stringify({ extends: "./tsconfig.pi-extensions.json", files }, null, 2)}\n`,
    "utf8",
  );
  effectiveConfig = scratchConfig;
}

const result = spawnSync(tsgo, ["--noEmit", "-p", effectiveConfig], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (effectiveConfig === scratchConfig) rmSync(scratchConfig, { force: true });
process.exit(result.status ?? 1);
