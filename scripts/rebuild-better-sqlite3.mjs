import { spawnSync } from "node:child_process";

const mode = process.argv[2];

if (mode !== "node") {
  console.error(`unsupported rebuild mode: ${mode ?? "undefined"}`);
  process.exit(1);
}

const result = spawnSync("pnpm", ["rebuild", "better-sqlite3"], {
  stdio: "inherit",
  env: process.env
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
