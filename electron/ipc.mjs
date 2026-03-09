import { ipcMain, shell } from "electron";
import path from "node:path";

function getDataDir() {
  if (process.env.SESSION_DB_PATH === ":memory:") {
    return path.join(process.cwd(), "data");
  }
  return path.dirname(process.env.SESSION_DB_PATH || path.join(process.cwd(), "data", "feishu-bot.sqlite"));
}

export function registerIpcHandlers() {
  ipcMain.handle("feishu-bot:open-config", async () => {
    await shell.openPath(path.join(process.cwd(), ".env"));
  });

  ipcMain.handle("feishu-bot:open-data", async () => {
    await shell.openPath(getDataDir());
  });
}
