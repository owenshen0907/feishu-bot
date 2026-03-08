import http from "node:http";
import { logInfo } from "./logger.js";

export function startHealthServer(params: {
  bind: string;
  port: number;
  getPayload: () => Record<string, unknown>;
}): http.Server | undefined {
  if (params.port <= 0) {
    return undefined;
  }
  const server = http.createServer((req, res) => {
    if (req.url !== "/health") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, ...params.getPayload() }));
  });
  server.listen(params.port, params.bind, () => {
    logInfo("health server listening", { bind: params.bind, port: params.port });
  });
  return server;
}
