import { ipcMain, shell } from "electron";
import {
  buildBootstrapPayload,
  openConfigPath,
  openDataPath,
  saveDesktopConfig
} from "./bridge-core.mjs";

export function registerIpcHandlers(options) {
  ipcMain.handle("feishu-bot:bootstrap", async () => buildBootstrapPayload());

  ipcMain.handle("feishu-bot:save-config", async (_event, payload) => {
    const bootstrap = saveDesktopConfig(payload);
    if (payload?.restartBackend) {
      await options.restartBackend();
      return buildBootstrapPayload({ restartRequired: false });
    }
    return bootstrap;
  });

  ipcMain.handle("feishu-bot:restart-backend", async () => {
    await options.restartBackend();
    return buildBootstrapPayload({ restartRequired: false });
  });

  ipcMain.handle("feishu-bot:open-config", async () => {
    return openConfigPath();
  });

  ipcMain.handle("feishu-bot:open-data", async () => {
    return openDataPath();
  });

  ipcMain.handle("feishu-bot:open-external", async (_event, rawUrl) => {
    const value = String(rawUrl ?? "").trim();
    if (!value.startsWith("https://")) {
      throw new Error("only https links are allowed");
    }
    await shell.openExternal(value);
  });
}
