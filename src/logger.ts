export function logInfo(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.log(`[${new Date().toISOString()}] INFO ${message}`, meta);
    return;
  }
  console.log(`[${new Date().toISOString()}] INFO ${message}`);
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.warn(`[${new Date().toISOString()}] WARN ${message}`, meta);
    return;
  }
  console.warn(`[${new Date().toISOString()}] WARN ${message}`);
}

export function logError(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.error(`[${new Date().toISOString()}] ERROR ${message}`, meta);
    return;
  }
  console.error(`[${new Date().toISOString()}] ERROR ${message}`);
}
