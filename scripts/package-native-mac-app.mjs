import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const distRoot = path.join(repoRoot, "dist");
const packageRoot = path.join(repoRoot, "macos", "FeishuBotApp");
const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const appName = "Feishu Bot";
const executableName = "FeishuBotApp";
const stagingRoot = path.join(repoRoot, ".native-macos-build");
const nativeOutputRoot = path.join(distRoot, "native-macos");
const appBundleRoot = path.join(stagingRoot, `${appName}.app`);
const contentsRoot = path.join(appBundleRoot, "Contents");
const macOSRoot = path.join(contentsRoot, "MacOS");
const resourcesRoot = path.join(contentsRoot, "Resources");
const backendRoot = path.join(resourcesRoot, "backend");
const backendDeployRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-backend-deploy-"));
const dmgStagingRoot = path.join(stagingRoot, "dmg-staging");
const dmgPath = path.join(stagingRoot, `${appName}.dmg`);
const iconFileName = "AppIcon.icns";
const appIconSource = path.join(repoRoot, "assets", "macos", iconFileName);

function formatArtifactTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function ensureEmptyDir(fullPath) {
  fs.rmSync(fullPath, { recursive: true, force: true });
  fs.mkdirSync(fullPath, { recursive: true });
}

function findSwiftBinary() {
  const candidates = [
    path.join(packageRoot, ".build", "release", executableName),
    path.join(packageRoot, ".build", "arm64-apple-macosx", "release", executableName),
    path.join(packageRoot, ".build", "apple", "Products", "Release", executableName)
  ];
  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw new Error("unable to find the SwiftUI app binary; run swift build --package-path macos/FeishuBotApp -c release first");
  }
  return match;
}

function writeInfoPlist() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleExecutable</key>
  <string>${executableName}</string>
  <key>CFBundleIdentifier</key>
  <string>com.feishubot.native</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${packageManifest.version}</string>
  <key>CFBundleVersion</key>
  <string>${packageManifest.version}</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(contentsRoot, "Info.plist"), plist, "utf8");
}

function copyTree(from, to, options = {}) {
  fs.cpSync(from, to, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    ...options
  });
}

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
  }
}

function preparePortableNodeModules() {
  ensureEmptyDir(backendDeployRoot);
  runOrThrow("pnpm", ["--filter", ".", "deploy", "--prod", "--legacy", backendDeployRoot], {
    cwd: repoRoot
  });
  runOrThrow("npm", ["rebuild", "better-sqlite3"], {
    cwd: backendDeployRoot
  });
}

function bundleResources() {
  const swiftBinary = findSwiftBinary();
  const nodeBinary = process.execPath;

  ensureEmptyDir(stagingRoot);
  preparePortableNodeModules();
  fs.mkdirSync(macOSRoot, { recursive: true });
  fs.mkdirSync(resourcesRoot, { recursive: true });
  fs.mkdirSync(path.join(resourcesRoot, "bin"), { recursive: true });
  fs.mkdirSync(path.join(backendRoot, "desktop"), { recursive: true });

  copyTree(swiftBinary, path.join(macOSRoot, executableName));
  fs.chmodSync(path.join(macOSRoot, executableName), 0o755);
  copyTree(nodeBinary, path.join(resourcesRoot, "bin", "node"));
  fs.chmodSync(path.join(resourcesRoot, "bin", "node"), 0o755);

  const backendDistRoot = path.join(backendRoot, "dist");
  fs.mkdirSync(backendDistRoot, { recursive: true });
  for (const entry of fs.readdirSync(path.join(repoRoot, "dist"))) {
    if (entry === "native-macos") {
      continue;
    }
    copyTree(path.join(repoRoot, "dist", entry), path.join(backendDistRoot, entry));
  }
  copyTree(path.join(backendDeployRoot, "node_modules"), path.join(backendRoot, "node_modules"), {
    verbatimSymlinks: true
  });
  for (const entry of fs.readdirSync(path.join(repoRoot, "desktop"))) {
    if (!entry.endsWith(".mjs")) {
      continue;
    }
    copyTree(path.join(repoRoot, "desktop", entry), path.join(backendRoot, "desktop", entry));
  }
  copyTree(path.join(repoRoot, "package.json"), path.join(backendRoot, "package.json"));
  if (fs.existsSync(appIconSource)) {
    copyTree(appIconSource, path.join(resourcesRoot, iconFileName));
  }

  writeInfoPlist();
}

function buildDmg() {
  ensureEmptyDir(dmgStagingRoot);
  copyTree(appBundleRoot, path.join(dmgStagingRoot, `${appName}.app`), {
    verbatimSymlinks: true
  });
  const applicationsLink = path.join(dmgStagingRoot, "Applications");
  try {
    fs.symlinkSync("/Applications", applicationsLink);
  } catch {
    // Ignore if the symlink already exists from a previous failed run.
  }
  fs.rmSync(dmgPath, { force: true });
  execFileSync("hdiutil", [
    "create",
    "-volname",
    appName,
    "-srcfolder",
    dmgStagingRoot,
    "-ov",
    "-format",
    "UDZO",
    dmgPath
  ], {
    stdio: "inherit"
  });
}

function publishArtifacts() {
  fs.mkdirSync(nativeOutputRoot, { recursive: true });

  const timestamp = formatArtifactTimestamp();
  const timestampedAppPath = path.join(nativeOutputRoot, `${appName}-${timestamp}.app`);
  const timestampedDmgPath = path.join(nativeOutputRoot, `${appName}-${timestamp}.dmg`);
  const canonicalAppPath = path.join(nativeOutputRoot, `${appName}.app`);
  const canonicalDmgPath = path.join(nativeOutputRoot, `${appName}.dmg`);

  fs.rmSync(timestampedAppPath, { recursive: true, force: true });
  runOrThrow("ditto", [appBundleRoot, timestampedAppPath]);
  fs.copyFileSync(dmgPath, timestampedDmgPath);

  let canonicalAppPublished = false;
  try {
    fs.rmSync(canonicalAppPath, { recursive: true, force: true });
    runOrThrow("ditto", [appBundleRoot, canonicalAppPath]);
    canonicalAppPublished = true;
  } catch (error) {
    console.warn(`warning: unable to overwrite ${canonicalAppPath}; keeping timestamped app instead (${error instanceof Error ? error.message : String(error)})`);
  }

  let canonicalDmgPublished = false;
  try {
    fs.copyFileSync(dmgPath, canonicalDmgPath);
    canonicalDmgPublished = true;
  } catch (error) {
    console.warn(`warning: unable to overwrite ${canonicalDmgPath}; keeping timestamped dmg instead (${error instanceof Error ? error.message : String(error)})`);
  }

  return {
    timestampedAppPath,
    timestampedDmgPath,
    canonicalAppPath: canonicalAppPublished ? canonicalAppPath : null,
    canonicalDmgPath: canonicalDmgPublished ? canonicalDmgPath : null
  };
}

bundleResources();
buildDmg();
const publishedArtifacts = publishArtifacts();
fs.rmSync(backendDeployRoot, { recursive: true, force: true });

if (publishedArtifacts.canonicalAppPath) {
  console.log(`native macOS app bundle created at ${publishedArtifacts.canonicalAppPath}`);
}
if (publishedArtifacts.canonicalDmgPath) {
  console.log(`native macOS dmg created at ${publishedArtifacts.canonicalDmgPath}`);
}
console.log(`timestamped native macOS app bundle created at ${publishedArtifacts.timestampedAppPath}`);
console.log(`timestamped native macOS dmg created at ${publishedArtifacts.timestampedDmgPath}`);
