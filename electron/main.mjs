import { app, BrowserWindow, Menu, nativeTheme, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import waitOn from "wait-on";
import { registerIpcHandlers } from "./ipc.mjs";
import {
  clearManagedEnv,
  ensureDefaultRuntimeConfig,
  getDataDir,
  getEnvPath,
  getRuntimeHome,
  readEnvConfig
} from "./runtime-config.mjs";

const isDev = process.env.ELECTRON_DEV === "true";
app.setName("Feishu Bot");

let mainWindow;
let backendStarted = false;
let backendHandle;
let backendModule;

function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(app.getAppPath(), "..");
}

function getHealthHost() {
  return process.env.HEALTH_BIND || "127.0.0.1";
}

function getHealthPort() {
  return Number(process.env.HEALTH_PORT || 3179);
}

function ensureRuntimeEnvironment() {
  const runtimeHome = app.getPath("userData");
  process.env.FEISHU_BOT_HOME = runtimeHome;
  ensureDefaultRuntimeConfig();
  const env = readEnvConfig();
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

async function importBackendModule() {
  if (!backendModule) {
    const entry = path.join(getAppRoot(), "dist", "index.js");
    backendModule = await import(pathToFileURL(entry).href);
  }
  if (typeof backendModule.startFeishuBot !== "function") {
    throw new Error("dist/index.js 未导出 startFeishuBot");
  }
  return backendModule;
}

async function startBackend() {
  if (isDev || backendStarted) {
    return;
  }
  clearManagedEnv();
  process.env.FEISHU_BOT_HOME = getRuntimeHome();
  const module = await importBackendModule();
  backendHandle = await module.startFeishuBot();
  backendStarted = true;
}

async function stopBackend() {
  if (!backendStarted) {
    return;
  }
  await backendHandle?.shutdown?.();
  backendHandle = undefined;
  backendStarted = false;
}

async function restartBackend() {
  if (isDev) {
    return;
  }
  await stopBackend();
  await startBackend();
}

async function waitForHealth() {
  const healthHost = getHealthHost();
  const healthPort = getHealthPort();
  await waitOn({
    resources: [`http://${healthHost}:${healthPort}/health`],
    timeout: 20000,
    interval: 500,
    headers: { Accept: "application/json" }
  });
}

function createWindow() {
  const appPath = getAppRoot();
  const htmlPath = path.join(appPath, "electron", "ui", "index.html");
  const preloadPath = path.join(appPath, "electron", "preload.mjs");
  const healthHost = getHealthHost();
  const healthPort = getHealthPort();
  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1080,
    minHeight: 760,
    resizable: true,
    title: "Feishu Bot Console",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111318" : "#ede7de",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
          vibrancy: "under-window",
          visualEffectState: "active"
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const query = new URLSearchParams({
    host: healthHost,
    port: String(healthPort),
    configDir: getRuntimeHome()
  }).toString();

  mainWindow.loadFile(htmlPath, { search: `?${query}` });
}

function setupMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Workspace",
      submenu: [
        {
          label: "打开 .env",
          click: () => void shell.openPath(getEnvPath())
        },
        {
          label: "打开数据目录",
          click: () => void shell.openPath(getDataDir())
        }
      ]
    },
    {
      label: "Window",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { role: "minimize" }, { role: "close" }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady()
  .then(async () => {
    ensureRuntimeEnvironment();
    registerIpcHandlers({ restartBackend });
    setupMenu();
    createWindow();
    try {
      await startBackend();
      await waitForHealth();
    } catch (error) {
      console.error("backend startup failed", error);
    }
  })
  .catch((error) => {
    console.error("app start failed", error);
    app.quit();
  });

app.on("before-quit", () => {
  void stopBackend().catch((error) => {
    console.error("failed to stop backend", error);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
