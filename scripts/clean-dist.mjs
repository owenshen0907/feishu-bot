import fs from "node:fs";
import path from "node:path";

const distRoot = path.resolve("dist");

fs.rmSync(distRoot, {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 100
});
