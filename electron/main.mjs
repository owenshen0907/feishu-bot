import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import waitOn from "wait-on";

const isDev = process.env.ELECTRON_DEV === "true";
const healthHost = process.env.HEALTH_BIND || "127.0.0.1";
const healthPort = Number(process.env.HEALTH_PORT || 3179);
let mainWindow;
let backendStarted = false;

async function ensureBackend() {
  if (isDev || backendStarted) {
    return;
  }
  const entry = path.join(app.getAppPath(), "dist", "index.js");
  try {
    await import(pathToFileURL(entry).href);
    backendStarted = true;
  } catch (error) {
    dialog.showErrorBox("Feishu Bot", `无法启动后台进程: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function waitForHealth() {
  try {
    await waitOn({
      resources: [`http://${healthHost}:${healthPort}/health`],
      timeout: 20000,
      interval: 500,
      headers: { Accept: "application/json" }
    });
  } catch (error) {
    dialog.showErrorBox(
      "Feishu Bot",
      `未能连接健康检查端口 http://${healthHost}:${healthPort}/health 。\n请检查 .env 是否允许健康检查对本机可见。`
    );
    throw error;
  }
}

function createWindow() {
  const appPath = app.getAppPath();
  const htmlPath = path.join(appPath, "electron", "ui", "index.html");
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    title: "Feishu Bot",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f1115" : "#f6f2ec",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
  });
  const query = new URLSearchParams({ host: healthHost, port: String(healthPort) }).toString();
  mainWindow.loadFile(htmlPath, { search: `?${query}` }).catch((error) => {
    dialog.showErrorBox("Feishu Bot", `无法加载状态页面: ${error instanceof Error ? error.message : String(error)}`);
  });
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
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "打开数据目录",
          click: () => void shell.openPath(getDataPath())
        },
        {
          label: "查看 .env",
          click: () => void shell.openPath(path.join(process.cwd(), ".env"))
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function getDataPath() {
  if (process.env.SESSION_DB_PATH === ":memory:") {
    return path.join(process.cwd(), "data");
  }
  return path.dirname(process.env.SESSION_DB_PATH || path.join(process.cwd(), "data", "feishu-bot.sqlite"));
}

app.whenReady()
  .then(async () => {
    setupMenu();
    await ensureBackend();
    await waitForHealth();
    createWindow();
  })
  .catch((error) => {
    console.error("app start failed", error);
    app.quit();
  });

app.on("before-quit", () => {
  try {
    process.emit("SIGINT");
  } catch (error) {
    console.error("failed to emit SIGINT", error);
  }
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
