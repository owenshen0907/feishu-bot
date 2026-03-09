import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("feishuBotDesktop", {
  bootstrap: () => ipcRenderer.invoke("feishu-bot:bootstrap"),
  saveConfig: (payload) => ipcRenderer.invoke("feishu-bot:save-config", payload),
  restartBackend: () => ipcRenderer.invoke("feishu-bot:restart-backend"),
  openConfig: () => ipcRenderer.invoke("feishu-bot:open-config"),
  openData: () => ipcRenderer.invoke("feishu-bot:open-data"),
  openExternal: (url) => ipcRenderer.invoke("feishu-bot:open-external", url)
});
