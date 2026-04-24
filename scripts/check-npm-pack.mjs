import { execFileSync } from "node:child_process";

const maxUnpackedSize = 30 * 1024 * 1024;
const maxEntryCount = 500;
const requiredFiles = [
  "dist/index.js",
  "desktop/bridge-core.mjs",
  "desktop/runtime-config.mjs",
  "README.md",
  "LICENSE"
];
const forbiddenPatterns = [
  /^dist\/native-macos\//,
  /^macos\/FeishuBotApp\/\.build\//,
  /(^|\/)node_modules\//,
  /\.dmg$/,
  /\.app\//,
  /^\.native-macos-build\//,
  /^data\//,
  /^console-settings\.json$/,
  /^undefined\//,
  /^\.env($|\.(?!example$|test\.example$|production\.example$))/
];

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024
});
const [pack] = JSON.parse(output);
const files = Array.isArray(pack?.files) ? pack.files : [];
const forbiddenFiles = files
  .map((file) => file.path)
  .filter((filePath) => forbiddenPatterns.some((pattern) => pattern.test(filePath)));
const includedFiles = new Set(files.map((file) => file.path));
const missingFiles = requiredFiles.filter((filePath) => !includedFiles.has(filePath));

if (forbiddenFiles.length > 0) {
  console.error("npm pack includes forbidden files:");
  for (const filePath of forbiddenFiles.slice(0, 50)) {
    console.error(`- ${filePath}`);
  }
  if (forbiddenFiles.length > 50) {
    console.error(`...and ${forbiddenFiles.length - 50} more`);
  }
  process.exit(1);
}

if (missingFiles.length > 0) {
  console.error("npm pack is missing required runtime files:");
  for (const filePath of missingFiles) {
    console.error(`- ${filePath}`);
  }
  process.exit(1);
}

if ((pack?.unpackedSize ?? 0) > maxUnpackedSize) {
  console.error(`npm pack unpacked size is too large: ${pack.unpackedSize} bytes`);
  process.exit(1);
}

if ((pack?.entryCount ?? files.length) > maxEntryCount) {
  console.error(`npm pack entry count is too large: ${pack.entryCount ?? files.length}`);
  process.exit(1);
}

console.log(`npm pack check passed: ${files.length} files, ${pack.unpackedSize} bytes unpacked.`);
