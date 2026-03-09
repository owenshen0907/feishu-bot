export function buildBootstrapPayload(options?: { restartRequired?: boolean }): Record<string, unknown>;
export function saveDesktopConfig(payload?: {
  env?: Record<string, string>;
  settings?: Record<string, unknown>;
}): Record<string, unknown>;
export function readHealthStatus(): Promise<Record<string, unknown>>;
export function openConfigPath(): { path: string };
export function openDataPath(): { path: string };
export function sendFeishuTestMessage(payload?: { receiveId?: string; receiveIdType?: string }): Promise<Record<string, unknown>>;
export function restartDetachedBackend(): Promise<Record<string, unknown>>;
export function stopDetachedBackend(): Promise<Record<string, unknown>>;
