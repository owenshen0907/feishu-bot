import process from "node:process";
// @ts-ignore bridge core is authored in Electron-side ESM and loaded at runtime.
import {
  buildBootstrapPayload,
  openConfigPath,
  openDataPath,
  readHealthStatus,
  restartDetachedBackend,
  saveDesktopConfig,
  sendFeishuTestMessage,
  stopDetachedBackend
} from "../electron/bridge-core.mjs";

interface BridgeRequest {
  command: "bootstrap" | "save-config" | "restart-backend" | "stop-backend" | "health" | "open-config" | "open-data" | "send-test-message";
  payload?: {
    env?: Record<string, string>;
    settings?: Record<string, unknown>;
    receiveId?: string;
    receiveIdType?: string;
  };
}

function assertNever(value: never): never {
  throw new Error(`unsupported bridge command: ${value}`);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      output += chunk;
    });
    process.stdin.on("end", () => resolve(output.trim()));
    process.stdin.on("error", reject);
  });
}

async function readRequest(): Promise<BridgeRequest> {
  const raw = process.argv[2] ?? (await readStdin());
  if (!raw) {
    throw new Error("missing bridge request payload");
  }
  return JSON.parse(raw);
}

async function runCommand(request: BridgeRequest) {
  switch (request.command) {
    case "bootstrap":
      return buildBootstrapPayload();
    case "save-config":
      return saveDesktopConfig(request.payload);
    case "restart-backend":
      return restartDetachedBackend();
    case "stop-backend":
      return stopDetachedBackend();
    case "health":
      return readHealthStatus();
    case "open-config":
      return openConfigPath();
    case "open-data":
      return openDataPath();
    case "send-test-message":
      return sendFeishuTestMessage(request.payload);
    default:
      return assertNever(request.command);
  }
}

async function main() {
  try {
    const request = await readRequest();
    const result = await runCommand(request);
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          result
        },
        null,
        2
      )
    );
  } catch (error) {
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

void main();
