function trim(value) {
  return String(value ?? "").trim();
}

function stripCodeFence(raw) {
  const text = trim(raw);
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? trim(fenced[1]) : text;
}

function extractJSONObject(raw) {
  const text = stripCodeFence(raw);
  if (!text) {
    throw new Error("请先粘贴自定义 HTTP 组件的一键配置 JSON。");
  }
  try {
    return JSON.parse(text);
  } catch {
    // Fall through and try to extract the first balanced JSON object.
  }

  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error("未识别到 JSON 对象，请直接粘贴完整的一键配置 JSON。");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, index + 1));
      }
    }
  }

  throw new Error("JSON 不完整，请确认复制的是完整的一键配置 JSON。");
}

function normalizeEnv(rawEnv = {}) {
  const env = {};
  for (const [key, value] of Object.entries(rawEnv || {})) {
    if (!trim(key)) {
      continue;
    }
    env[String(key)] = String(value ?? "");
  }
  return env;
}

function normalizeStringArray(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => trim(value))
    .filter(Boolean);
}

function readTargetEnvAlias(targetEnv = {}, primaryKey, legacyKey) {
  return trim(targetEnv[primaryKey]) || trim(targetEnv[legacyKey]);
}

function buildBridgeEnv(interfacePayload = {}) {
  const headers = interfacePayload?.headers && typeof interfacePayload.headers === "object" ? interfacePayload.headers : {};
  const auth = interfacePayload?.auth && typeof interfacePayload.auth === "object" ? interfacePayload.auth : {};
  return {
    DIAGNOSTIC_HTTP_BASE_URL: trim(interfacePayload.base_url),
    DIAGNOSTIC_HTTP_TOKEN: trim(auth.token),
    DIAGNOSTIC_HTTP_CALLER: trim(headers["X-Bridge-Caller"]) || "feishu-bot",
    DIAGNOSTIC_HTTP_TIMEOUT_MS: trim(interfacePayload.timeout_ms) || "20000"
  };
}

function findBridgeInterface(bundle) {
  const interfaces = Array.isArray(bundle?.interfaces) ? bundle.interfaces : [];
  return interfaces.find((item) => trim(item?.schema) === "diagnostic-bridge/v1") || null;
}

function findComponentMetadata(payload, bridgeInterface) {
  const provider = payload?.provider && typeof payload.provider === "object" ? payload.provider : {};
  const componentTarget = payload?.targets?.feishu_bot_desktop?.component;
  const targetComponent = componentTarget && typeof componentTarget === "object" ? componentTarget : {};

  return {
    id: "",
    name: trim(targetComponent?.name) || trim(provider?.name) || trim(bridgeInterface?.name) || "自定义 HTTP 组件",
    summary: trim(targetComponent?.summary) || trim(provider?.summary) || trim(provider?.description) || trim(bridgeInterface?.summary) || trim(bridgeInterface?.description),
    usageDescription: trim(targetComponent?.usageDescription) || trim(provider?.usageDescription) || trim(provider?.purpose) || trim(bridgeInterface?.usage_description) || trim(bridgeInterface?.purpose),
    examplePrompts: normalizeStringArray(targetComponent?.examplePrompts || provider?.examplePrompts || provider?.examples || bridgeInterface?.example_prompts || bridgeInterface?.examples),
    baseUrl: envCompatibleBaseUrl(payload, bridgeInterface),
    token: envCompatibleToken(payload, bridgeInterface),
    caller: envCompatibleCaller(payload, bridgeInterface),
    timeoutMs: envCompatibleTimeout(payload, bridgeInterface)
  };
}

function envCompatibleBaseUrl(payload, bridgeInterface) {
  const targetEnv = normalizeEnv(payload?.targets?.feishu_bot_desktop?.env);
  return readTargetEnvAlias(targetEnv, "DIAGNOSTIC_HTTP_BASE_URL", "SMARTKIT_BASE_URL") || trim(bridgeInterface?.base_url);
}

function envCompatibleToken(payload, bridgeInterface) {
  const targetEnv = normalizeEnv(payload?.targets?.feishu_bot_desktop?.env);
  const auth = bridgeInterface?.auth && typeof bridgeInterface.auth === "object" ? bridgeInterface.auth : {};
  return readTargetEnvAlias(targetEnv, "DIAGNOSTIC_HTTP_TOKEN", "SMARTKIT_TOKEN") || trim(auth.token);
}

function envCompatibleCaller(payload, bridgeInterface) {
  const targetEnv = normalizeEnv(payload?.targets?.feishu_bot_desktop?.env);
  const headers = bridgeInterface?.headers && typeof bridgeInterface.headers === "object" ? bridgeInterface.headers : {};
  return readTargetEnvAlias(targetEnv, "DIAGNOSTIC_HTTP_CALLER", "SMARTKIT_CALLER") || trim(headers["X-Bridge-Caller"]) || "feishu-bot";
}

function envCompatibleTimeout(payload, bridgeInterface) {
  const targetEnv = normalizeEnv(payload?.targets?.feishu_bot_desktop?.env);
  const raw = readTargetEnvAlias(targetEnv, "DIAGNOSTIC_HTTP_TIMEOUT_MS", "SMARTKIT_TIMEOUT_MS") || trim(bridgeInterface?.timeout_ms) || "20000";
  return Number(raw) > 0 ? Number(raw) : 20000;
}

export function parseDiagnosticComponentConfig(rawText) {
  const payload = extractJSONObject(rawText);
  const schema = trim(payload?.schema);

  if (!["http-component-bundle/v1", "smartkit-provider-bundle/v1"].includes(schema)) {
    throw new Error(
      `当前只支持组件配置页导出的一键配置 JSON（schema=http-component-bundle/v1，兼容旧的 smartkit-provider-bundle/v1），不支持 ${schema || "unknown"}。`
    );
  }

  const targetEnv = normalizeEnv(payload?.targets?.feishu_bot_desktop?.env);
  const bridgeInterface = findBridgeInterface(payload);
  const derivedEnv = buildBridgeEnv(bridgeInterface || {});
  const env = {
    DIAGNOSTIC_HTTP_BASE_URL: readTargetEnvAlias(targetEnv, "DIAGNOSTIC_HTTP_BASE_URL", "SMARTKIT_BASE_URL") || trim(derivedEnv.DIAGNOSTIC_HTTP_BASE_URL),
    DIAGNOSTIC_HTTP_TOKEN: readTargetEnvAlias(targetEnv, "DIAGNOSTIC_HTTP_TOKEN", "SMARTKIT_TOKEN") || trim(derivedEnv.DIAGNOSTIC_HTTP_TOKEN),
    DIAGNOSTIC_HTTP_CALLER: readTargetEnvAlias(targetEnv, "DIAGNOSTIC_HTTP_CALLER", "SMARTKIT_CALLER") || trim(derivedEnv.DIAGNOSTIC_HTTP_CALLER) || "feishu-bot",
    DIAGNOSTIC_HTTP_TIMEOUT_MS: readTargetEnvAlias(targetEnv, "DIAGNOSTIC_HTTP_TIMEOUT_MS", "SMARTKIT_TIMEOUT_MS") || trim(derivedEnv.DIAGNOSTIC_HTTP_TIMEOUT_MS) || "20000"
  };

  if (!env.DIAGNOSTIC_HTTP_BASE_URL) {
    throw new Error("一键配置 JSON 里缺少 Feishu Bot 所需的组件地址，无法导入。");
  }

  const component = findComponentMetadata(payload, bridgeInterface);

  return {
    kind: "diagnosticHttp",
    title: `${component.name} 配置已解析`,
    detail: `已识别 ${component.name} 的接入信息，可直接填入 Feishu Bot。`,
    env,
    component
  };
}
