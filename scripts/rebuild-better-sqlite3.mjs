import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2];

if (!["electron", "node"].includes(mode ?? "")) {
  console.error(`unsupported rebuild mode: ${mode ?? "undefined"}`);
  process.exit(1);
}

const packageJsonPath = path.resolve(import.meta.dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

let env = process.env;
if (mode === "electron") {
  const electronVersion = String(packageJson.devDependencies?.electron ?? "").replace(/^[^\d]*/, "");

  if (!electronVersion) {
    console.error("unable to resolve electron version from package.json");
    process.exit(1);
  }

  env = {
    ...process.env,
    npm_config_runtime: "electron",
    npm_config_target: electronVersion,
    npm_config_disturl: "https://electronjs.org/headers"
  };
}

const result = spawnSync("pnpm", ["rebuild", "better-sqlite3"], {
  stdio: "inherit",
  env
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
