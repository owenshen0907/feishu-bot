const desktopApi = window.feishuBotDesktop;
const params = new URLSearchParams(window.location.search);
const host = params.get("host") || "127.0.0.1";
const port = params.get("port") || "3179";
const configDir = params.get("configDir") || ".";
const appRoot = document.getElementById("app");

const state = {
  bootstrap: null,
  draftEnv: null,
  draftSettings: null,
  health: null,
  activeTab: "features",
  busy: false,
  notice: "",
  error: ""
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function checkboxAttr(value) {
  return value ? "checked" : "";
}

function selectedAttr(left, right) {
  return left === right ? "selected" : "";
}

function boolFromEnv(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function defaultRule() {
  return {
    id: "",
    name: "",
    mode: "allow",
    note: "",
    capabilities: {
      chat: true,
      smartkit: true,
      webSearch: true,
      voiceReply: true,
      vision: true
    }
  };
}

function syncDrafts(force = false) {
  if (!state.bootstrap) {
    return;
  }
  if (!state.draftEnv || force) {
    state.draftEnv = clone(state.bootstrap.env);
  }
  if (!state.draftSettings || force) {
    state.draftSettings = clone(state.bootstrap.settings);
  }
}

function onboardingReady() {
  return Boolean(
    state.draftEnv?.FEISHU_APP_ID &&
      state.draftEnv?.FEISHU_APP_SECRET &&
      state.draftEnv?.BOT_LLM_API_KEY
  );
}

async function fetchHealth() {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      headers: {
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.health = await response.json();
  } catch (error) {
    state.health = {
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function normalizeBeforeSave() {
  const env = clone(state.draftEnv);
  if (env.BOT_LLM_PROVIDER === "stepfun") {
    const provider = state.bootstrap.catalogs.providers.find((item) => item.id === "stepfun");
    if (provider) {
      env.BOT_LLM_BASE_URL = provider.baseUrl;
      env.BOT_LLM_MODEL = provider.chatModel;
      env.BOT_VISION_MODEL = provider.visionModel;
      env.BOT_TTS_MODEL = provider.ttsModel;
    }
  }
  env.BOT_LLM_ENABLED = "true";
  env.BOT_CHAT_ENABLED = env.BOT_CHAT_ENABLED || "true";
  return {
    env,
    settings: clone(state.draftSettings)
  };
}

async function saveAll(options = {}) {
  state.busy = true;
  state.error = "";
  state.notice = "";
  render();
  try {
    const payload = normalizeBeforeSave();
    const bootstrap = await desktopApi.saveConfig({
      ...payload,
      restartBackend: Boolean(options.restartBackend)
    });
    state.bootstrap = bootstrap;
    syncDrafts(true);
    if (options.nextTab) {
      state.activeTab = options.nextTab;
    }
    state.notice = options.notice || "配置已保存。";
    await fetchHealth();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function providerOptions() {
  return state.bootstrap.catalogs.providers
    .map((provider) => `<option value="${escapeHtml(provider.id)}" ${selectedAttr(state.draftEnv.BOT_LLM_PROVIDER, provider.id)}>${escapeHtml(provider.name)}</option>`)
    .join("");
}

function healthMessage(feature, fallback) {
  if (state.health?.error) {
    return state.health.error;
  }
  return state.health?.features?.[feature]?.message || fallback;
}

function renderChecklistItem(label, ready, description) {
  return `
    <div class="check-item ${ready ? "ready" : "missing"}">
      <span class="check-dot"></span>
      <div>
        <strong>${escapeHtml(label)}</strong>
        <div>${escapeHtml(description)}</div>
      </div>
    </div>
  `;
}

function renderSidebar() {
  const features = state.health?.features || {};
  const nextSteps = Array.isArray(state.health?.nextSteps) ? state.health.nextSteps : [];
  return `
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-kicker">Desktop Console</span>
        <h1>Feishu Bot</h1>
        <p>先引导接入飞书与模型，再继续做能力、权限和群组编排。</p>
      </div>

      <section class="sidebar-section">
        <h2>运行状态</h2>
        <div class="sidebar-list">
          <div class="status-chip">
            <strong>飞书接入</strong>
            <span>${escapeHtml(features.feishu?.message || "等待健康检查返回状态")}</span>
          </div>
          <div class="status-chip">
            <strong>SmartKit</strong>
            <span>${escapeHtml(features.smartkit?.message || "未启用或尚未接入")}</span>
          </div>
          <div class="status-chip">
            <strong>聊天模型</strong>
            <span>${escapeHtml(features.chat?.message || "等待健康检查返回状态")}</span>
          </div>
        </div>
      </section>

      <section class="sidebar-section">
        <h2>快速操作</h2>
        <div class="quick-actions">
          <button class="quick-button" data-action="open-config">打开 .env</button>
          <button class="quick-button" data-action="open-data">打开数据目录</button>
          <button class="quick-button" data-action="restart-backend">重启后台</button>
        </div>
      </section>

      <section class="sidebar-section">
        <h2>控制台导航</h2>
        <div class="tab-list">
          <button class="tab-button ${state.activeTab === "features" ? "active" : ""}" data-action="switch-tab" data-tab="features">功能添加</button>
          <button class="tab-button ${state.activeTab === "permissions" ? "active" : ""}" data-action="switch-tab" data-tab="permissions">群组与用户权限</button>
          <button class="tab-button ${state.activeTab === "abilities" ? "active" : ""}" data-action="switch-tab" data-tab="abilities">Bot 能力</button>
        </div>
      </section>

      <div class="sidebar-note">
        配置目录：<br />
        <strong>${escapeHtml(configDir)}</strong>
        ${nextSteps.length > 0 ? `<br /><br />下一步：${escapeHtml(nextSteps[0])}` : ""}
      </div>
    </aside>
  `;
}

function renderHero() {
  const env = state.draftEnv;
  const providerLabel = state.bootstrap.catalogs.providers.find((item) => item.id === env.BOT_LLM_PROVIDER)?.name || env.BOT_LLM_PROVIDER;
  return `
    <section class="hero">
      <div class="hero-main">
        <h2>先把机器人接上线，再决定它能看什么、说什么、在哪些群里工作。</h2>
        <p>这套控制台会优先引导飞书 App ID / App Secret 和模型接入。完成后，直接进入功能添加页继续补 SmartKit、权限和扩展能力。</p>
        <div class="hero-metrics">
          <div class="mini-stat">
            <label>模型供应商</label>
            <strong>${escapeHtml(providerLabel)}</strong>
          </div>
          <div class="mini-stat">
            <label>聊天模型</label>
            <strong>${escapeHtml(env.BOT_LLM_MODEL)}</strong>
          </div>
          <div class="mini-stat">
            <label>权限规则</label>
            <strong>${state.draftSettings.permissions.groups.length + state.draftSettings.permissions.users.length} 条</strong>
          </div>
        </div>
      </div>
      <div class="hero-side">
        <p>首启必填</p>
        <div class="checklist">
          ${renderChecklistItem("飞书 App ID", Boolean(env.FEISHU_APP_ID), env.FEISHU_APP_ID ? "已填写" : "用于建立长连接")}
          ${renderChecklistItem("飞书 App Secret", Boolean(env.FEISHU_APP_SECRET), env.FEISHU_APP_SECRET ? "已填写" : "用于交换租户凭据")}
          ${renderChecklistItem("模型 API Key", Boolean(env.BOT_LLM_API_KEY), env.BOT_LLM_API_KEY ? "已填写" : "默认接阶跃星辰")}
        </div>
        <div class="footer-note">配置文件：${escapeHtml(state.bootstrap.envPath)}</div>
      </div>
    </section>
  `;
}

function renderField(label, key, options = {}) {
  const value = state.draftEnv[key] ?? "";
  const hint = options.hint ? `<small>${escapeHtml(options.hint)}</small>` : "";
  const full = options.full ? "full" : "";
  if (options.type === "textarea") {
    return `
      <div class="field ${full}">
        <label for="${escapeHtml(key)}">${escapeHtml(label)}</label>
        <textarea id="${escapeHtml(key)}" data-env-key="${escapeHtml(key)}">${escapeHtml(value)}</textarea>
        ${hint}
      </div>
    `;
  }
  if (options.type === "select") {
    return `
      <div class="field ${full}">
        <label for="${escapeHtml(key)}">${escapeHtml(label)}</label>
        <select id="${escapeHtml(key)}" data-env-key="${escapeHtml(key)}">${options.options}</select>
        ${hint}
      </div>
    `;
  }
  return `
    <div class="field ${full}">
      <label for="${escapeHtml(key)}">${escapeHtml(label)}</label>
      <input id="${escapeHtml(key)}" data-env-key="${escapeHtml(key)}" value="${escapeHtml(value)}" ${options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ""} />
      ${hint}
    </div>
  `;
}

function renderFeaturesTab() {
  return `
    <section class="panel-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>飞书接入</h3>
            <p>这是上线机器人的硬前置。填完 App ID 和 App Secret 后，保存即可让桌面版尝试建立飞书长连接。</p>
          </div>
          <span class="pill">${escapeHtml(healthMessage("feishu", "等待接入"))}</span>
        </div>
        <div class="field-grid">
          ${renderField("FEISHU_APP_ID", "FEISHU_APP_ID", { hint: "飞书应用凭据，必填。" })}
          ${renderField("FEISHU_APP_SECRET", "FEISHU_APP_SECRET", { hint: "飞书应用密钥，必填。" })}
          ${renderField("机器人名称", "FEISHU_BOT_NAME", { full: true, hint: "用于群聊 @ 名称匹配。" })}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>模型接入</h3>
            <p>默认接入阶跃星辰。你可以直接填 API Key，保留默认的文本、视觉和语音模型；也可以切到自定义 OpenAI Compatible。</p>
          </div>
          <div class="inline-actions">
            <button class="small-link-button" data-action="open-external" data-url="${escapeHtml(state.bootstrap.docs.stepApiKey)}">获取 API Key</button>
          </div>
        </div>
        <div class="field-grid">
          ${renderField("模型供应商", "BOT_LLM_PROVIDER", { type: "select", options: providerOptions(), hint: "默认阶跃星辰 StepFun。" })}
          ${renderField("BOT_LLM_API_KEY", "BOT_LLM_API_KEY", { hint: "这是首启必填项。" })}
          ${renderField("BOT_LLM_BASE_URL", "BOT_LLM_BASE_URL", { hint: "StepFun 默认：https://api.stepfun.com/v1" })}
          ${renderField("BOT_LLM_MODEL", "BOT_LLM_MODEL", { hint: "默认：step-3.5-flash" })}
          ${renderField("BOT_VISION_MODEL", "BOT_VISION_MODEL", { hint: "默认：step-1o-turbo-vision" })}
          ${renderField("BOT_TTS_MODEL", "BOT_TTS_MODEL", { hint: "默认：step-tts-2" })}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>可选日志能力</h3>
            <p>SmartKit 不是首启阻塞项。不接日志时，机器人仍然可以作为普通聊天机器人运行。</p>
          </div>
          <span class="pill">${escapeHtml(healthMessage("smartkit", "未接入"))}</span>
        </div>
        <div class="field-grid">
          ${renderField("SMARTKIT_BASE_URL", "SMARTKIT_BASE_URL", { full: true, hint: "可留空；后面需要日志诊断时再补。" })}
          ${renderField("SMARTKIT_TOKEN", "SMARTKIT_TOKEN", { full: true, hint: "如果 SmartKit 开启鉴权，再填写这里。" })}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>运行参数</h3>
            <p>这些参数不需要你每次都管，但控制台保留了入口，方便切测试环境或改健康端口。</p>
          </div>
        </div>
        <div class="field-grid compact">
          ${renderField("BOT_PROFILE", "BOT_PROFILE")}
          ${renderField("HEALTH_BIND", "HEALTH_BIND")}
          ${renderField("HEALTH_PORT", "HEALTH_PORT")}
          ${renderField("SESSION_DB_PATH", "SESSION_DB_PATH", { full: true })}
        </div>
        <div class="button-row">
          <button class="save-button" data-action="save-features">${state.busy ? "保存中..." : "保存并重启后台"}</button>
          <button class="ghost-button" data-action="open-config">直接查看 .env</button>
        </div>
      </div>
    </section>
  `;
}

function renderRuleCard(kind, rule, index) {
  return `
    <div class="rule-card">
      <div class="rule-card-head">
        <div>
          <h4>${kind === "groups" ? "飞书群规则" : "用户规则"} #${index + 1}</h4>
          <p>${kind === "groups" ? "按 chat_id 或群名称备注管理" : "按 user_id 管理允许范围"}。</p>
        </div>
        <button class="ghost-button" data-action="remove-rule" data-kind="${escapeHtml(kind)}" data-index="${index}">删除</button>
      </div>
      <div class="field-grid">
        <div class="field">
          <label>${kind === "groups" ? "群 ID / chat_id" : "用户 ID / user_id"}</label>
          <input data-rule-field="id" data-kind="${escapeHtml(kind)}" data-index="${index}" value="${escapeHtml(rule.id)}" />
        </div>
        <div class="field">
          <label>备注名称</label>
          <input data-rule-field="name" data-kind="${escapeHtml(kind)}" data-index="${index}" value="${escapeHtml(rule.name)}" />
        </div>
        <div class="field">
          <label>模式</label>
          <select data-rule-field="mode" data-kind="${escapeHtml(kind)}" data-index="${index}">
            <option value="allow" ${selectedAttr(rule.mode, "allow")}>允许</option>
            <option value="readonly" ${selectedAttr(rule.mode, "readonly")}>只读</option>
            <option value="block" ${selectedAttr(rule.mode, "block")}>禁用</option>
          </select>
        </div>
        <div class="field full">
          <label>备注</label>
          <textarea data-rule-field="note" data-kind="${escapeHtml(kind)}" data-index="${index}">${escapeHtml(rule.note)}</textarea>
        </div>
      </div>
      <div class="rule-capabilities">
        ${state.bootstrap.catalogs.capabilities.map((capability) => `
          <label class="rule-capability">
            <input type="checkbox" data-rule-capability="${escapeHtml(capability.id)}" data-kind="${escapeHtml(kind)}" data-index="${index}" ${checkboxAttr(rule.capabilities[capability.id] ?? true)} />
            <span>${escapeHtml(capability.label)}</span>
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function renderPermissionsTab() {
  const groups = state.draftSettings.permissions.groups;
  const users = state.draftSettings.permissions.users;
  return `
    <section class="panel-grid single">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>群组与用户权限</h3>
            <p>先把权限规则沉淀在控制台里，后续你可以按群、按用户分配不同能力组合。默认策略可选全部放开，或者只允许白名单。</p>
          </div>
          <span class="pill">当前 ${groups.length + users.length} 条规则</span>
        </div>
        <div class="field-grid compact">
          <div class="field">
            <label>默认模式</label>
            <select data-settings-default-mode="true">
              <option value="allow" ${selectedAttr(state.draftSettings.permissions.defaultMode, "allow")}>默认允许</option>
              <option value="restricted" ${selectedAttr(state.draftSettings.permissions.defaultMode, "restricted")}>仅白名单允许</option>
            </select>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="rule-toolbar">
          <div>
            <h3>飞书群权限</h3>
            <p>适合限制哪些群可以用日志诊断、联网搜索或语音回复。</p>
          </div>
          <button class="secondary-button" data-action="add-rule" data-kind="groups">新增群规则</button>
        </div>
        <div class="rule-list">
          ${groups.length > 0 ? groups.map((rule, index) => renderRuleCard("groups", rule, index)).join("") : '<div class="empty-state">还没有群规则。默认可以先全放开，等上线后再逐步收口。</div>'}
        </div>
      </div>

      <div class="panel">
        <div class="rule-toolbar">
          <div>
            <h3>用户权限</h3>
            <p>适合给管理员、测试同学或特定业务方单独开能力。</p>
          </div>
          <button class="secondary-button" data-action="add-rule" data-kind="users">新增用户规则</button>
        </div>
        <div class="rule-list">
          ${users.length > 0 ? users.map((rule, index) => renderRuleCard("users", rule, index)).join("") : '<div class="empty-state">还没有用户规则。你可以先配置群，再按需给个人开白名单。</div>'}
        </div>
        <div class="button-row">
          <button class="save-button" data-action="save-permissions">${state.busy ? "保存中..." : "保存权限规则"}</button>
        </div>
      </div>
    </section>
  `;
}

function renderAbilitiesTab() {
  return `
    <section class="panel-grid single">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Bot 能力编排</h3>
            <p>这里先把外部能力的开关、模型和 API Key 管起来。能力配置会落到本地 <code>.env</code>，后续消息链路接线后即可直接使用。</p>
          </div>
          <span class="pill">扩展能力控制面</span>
        </div>
        <div class="banner">
          这版控制台先完成能力入口与配置沉淀。Brave Search、语音回复、视觉理解的消息执行链可以后续继续接入，不影响现在先做运营配置。
        </div>
      </div>

      <div class="ability-list">
        <div class="ability-card">
          <div class="ability-card-head">
            <div>
              <h4>联网搜索</h4>
              <p>使用 Brave Search API。适合给机器人补实时网页检索能力。</p>
            </div>
            <div class="inline-actions">
              <button class="small-link-button" data-action="open-external" data-url="${escapeHtml(state.bootstrap.docs.braveSearch)}">查看 Brave API</button>
            </div>
          </div>
          <div class="switch-row">
            <input type="checkbox" data-env-bool="BOT_CAPABILITY_WEB_SEARCH" ${checkboxAttr(boolFromEnv(state.draftEnv.BOT_CAPABILITY_WEB_SEARCH))} />
            <label>启用 Brave Search</label>
          </div>
          <div class="field-grid">
            ${renderField("BRAVE_SEARCH_API_KEY", "BRAVE_SEARCH_API_KEY", { full: true, hint: `官方接口：${state.bootstrap.catalogs.braveEndpoint}` })}
          </div>
        </div>

        <div class="ability-card">
          <div class="ability-card-head">
            <div>
              <h4>语音回复</h4>
              <p>默认使用 StepFun <code>step-tts-2</code>。适合把回复直接生成为音频消息。</p>
            </div>
          </div>
          <div class="switch-row">
            <input type="checkbox" data-env-bool="BOT_CAPABILITY_VOICE_REPLY" ${checkboxAttr(boolFromEnv(state.draftEnv.BOT_CAPABILITY_VOICE_REPLY))} />
            <label>启用语音回复</label>
          </div>
          <div class="field-grid">
            ${renderField("语音模型", "BOT_TTS_MODEL", { full: true })}
          </div>
        </div>

        <div class="ability-card">
          <div class="ability-card-head">
            <div>
              <h4>视觉理解</h4>
              <p>默认使用 StepFun <code>step-1o-turbo-vision</code>。适合图片、截图、视频封面理解场景。</p>
            </div>
          </div>
          <div class="switch-row">
            <input type="checkbox" data-env-bool="BOT_CAPABILITY_VISION" ${checkboxAttr(boolFromEnv(state.draftEnv.BOT_CAPABILITY_VISION))} />
            <label>启用视觉理解</label>
          </div>
          <div class="field-grid">
            ${renderField("视觉模型", "BOT_VISION_MODEL", { full: true })}
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="button-row">
          <button class="save-button" data-action="save-abilities">${state.busy ? "保存中..." : "保存能力配置并重启后台"}</button>
        </div>
      </div>
    </section>
  `;
}

function renderBanner() {
  if (state.error) {
    return `<div class="banner error">${escapeHtml(state.error)}</div>`;
  }
  if (state.notice) {
    return `<div class="banner">${escapeHtml(state.notice)}</div>`;
  }
  return "";
}

function renderConsole() {
  const content = state.activeTab === "permissions"
    ? renderPermissionsTab()
    : state.activeTab === "abilities"
      ? renderAbilitiesTab()
      : renderFeaturesTab();
  return `
    ${renderSidebar()}
    <main class="content">
      <div class="page">
        ${renderHero()}
        ${renderBanner()}
        ${content}
      </div>
    </main>
  `;
}

function renderOnboarding() {
  const env = state.draftEnv;
  const providerLabel = state.bootstrap.catalogs.providers.find((item) => item.id === env.BOT_LLM_PROVIDER)?.name || env.BOT_LLM_PROVIDER;
  const banner = renderBanner();
  const readyCount = [
    Boolean(env.FEISHU_APP_ID),
    Boolean(env.FEISHU_APP_SECRET),
    Boolean(env.BOT_LLM_PROVIDER),
    Boolean(env.BOT_LLM_API_KEY)
  ].filter(Boolean).length;
  return `
    <main class="setup-shell">
      <section class="setup-board">
        <aside class="setup-rail">
          <div class="setup-brand">
            <div class="setup-brand-mark">FB</div>
            <div>
              <p class="setup-kicker">首次设置</p>
              <h1>先把机器人接上线，再继续加能力。</h1>
            </div>
          </div>

          <p class="setup-lead">首启只保留飞书和模型的关键字段。权限、SmartKit 和扩展能力留到控制台里继续配置。</p>

          <div class="setup-status-row">
            <div class="setup-status-card">
              <span>飞书状态</span>
              <strong>${escapeHtml(healthMessage("feishu", "等待填写凭据"))}</strong>
            </div>
            <div class="setup-status-card">
              <span>模型供应商</span>
              <strong>${escapeHtml(providerLabel)}</strong>
            </div>
          </div>

          <div class="setup-step-list">
            <div class="setup-step-card">
              <span>01</span>
              <strong>连接飞书</strong>
              <p>App ID 和 App Secret 是桌面端建立长连接的前置条件。</p>
            </div>
            <div class="setup-step-card">
              <span>02</span>
              <strong>接入模型</strong>
              <p>${escapeHtml(providerLabel)} 默认填好模型预设，也支持切换到自定义兼容接口。</p>
            </div>
            <div class="setup-step-card">
              <span>03</span>
              <strong>进入控制台</strong>
              <p>保存后自动重启后台，并跳到“功能添加”继续补完整配置。</p>
            </div>
          </div>

          <div class="setup-meta-card">
            <span>配置文件</span>
            <code>${escapeHtml(state.bootstrap.envPath)}</code>
            <p>建议保留在本地环境，不要提交到仓库。</p>
          </div>
        </aside>

        <section class="setup-main">
          <header class="setup-header">
            <div>
              <p class="setup-kicker">Mac 风格的引导页</p>
              <h2>飞书与模型凭据</h2>
              <p>用更接近系统设置的分组表单处理首启项，字段不堆满，信息层级也更清楚。</p>
            </div>
            <div class="setup-header-actions">
              <button class="toolbar-button" data-action="open-config">打开 .env</button>
              <button class="toolbar-button" data-action="open-data">数据目录</button>
              <button class="toolbar-button primary" data-action="open-external" data-url="${escapeHtml(state.bootstrap.docs.stepApiKey)}">获取 Step API Key</button>
            </div>
          </header>

          ${banner ? `<div class="setup-banner-wrap">${banner}</div>` : ""}

          <section class="setup-group">
            <div class="setup-group-head">
              <div>
                <h3>飞书接入</h3>
                <p>这里只放机器人上线必须字段，避免首屏噪音太多。</p>
              </div>
              <span class="setup-group-tag">${env.FEISHU_APP_ID && env.FEISHU_APP_SECRET ? "已就绪" : "待填写"}</span>
            </div>
            <div class="setup-grid">
              ${renderField("FEISHU_APP_ID", "FEISHU_APP_ID", { hint: "必填" })}
              ${renderField("FEISHU_APP_SECRET", "FEISHU_APP_SECRET", { hint: "必填" })}
            </div>
          </section>

          <section class="setup-group">
            <div class="setup-group-head">
              <div>
                <h3>模型接入</h3>
                <p>默认接入 StepFun，也支持改为自定义 OpenAI Compatible。</p>
              </div>
              <span class="setup-group-tag">${env.BOT_LLM_API_KEY ? "已填写 API Key" : "待填写 API Key"}</span>
            </div>
            <div class="setup-grid">
              ${renderField("模型供应商", "BOT_LLM_PROVIDER", { type: "select", options: providerOptions(), full: true })}
              ${renderField("BOT_LLM_API_KEY", "BOT_LLM_API_KEY", { full: true, hint: "必填" })}
              ${renderField("BOT_LLM_BASE_URL", "BOT_LLM_BASE_URL", { hint: providerLabel === "StepFun" ? "默认：https://api.stepfun.com/v1" : "可自定义 OpenAI Compatible" })}
              ${renderField("BOT_LLM_MODEL", "BOT_LLM_MODEL")}
              ${renderField("BOT_VISION_MODEL", "BOT_VISION_MODEL")}
              ${renderField("BOT_TTS_MODEL", "BOT_TTS_MODEL")}
            </div>
          </section>

          <footer class="setup-footer">
            <div class="setup-footer-note">
              <strong>${readyCount}/4 个关键项已就绪</strong>
              <p>保存后会自动重启后台，并直接进入功能添加页面。</p>
            </div>
            <button class="save-button setup-save" data-action="save-onboarding">${state.busy ? "保存中..." : "保存并进入控制台"}</button>
          </footer>
        </section>
      </section>
    </main>
  `;
}

function render() {
  if (!state.bootstrap || !state.draftEnv || !state.draftSettings) {
    appRoot.innerHTML = '<div class="loading-state">正在加载控制台...</div>';
    return;
  }
  appRoot.className = state.bootstrap.onboarding.complete ? "app-shell" : "onboarding-root";
  appRoot.innerHTML = state.bootstrap.onboarding.complete ? renderConsole() : renderOnboarding();
}

function updateEnvValue(key, value) {
  state.draftEnv[key] = value;
  if (key === "BOT_LLM_PROVIDER" && value === "stepfun") {
    const provider = state.bootstrap.catalogs.providers.find((item) => item.id === "stepfun");
    if (provider) {
      state.draftEnv.BOT_LLM_BASE_URL = provider.baseUrl;
      state.draftEnv.BOT_LLM_MODEL = provider.chatModel;
      state.draftEnv.BOT_VISION_MODEL = provider.visionModel;
      state.draftEnv.BOT_TTS_MODEL = provider.ttsModel;
    }
  }
}

function updateRuleField(kind, index, field, value) {
  state.draftSettings.permissions[kind][index][field] = value;
}

function updateRuleCapability(kind, index, capability, checked) {
  state.draftSettings.permissions[kind][index].capabilities[capability] = checked;
}

function handleFieldMutation(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (target.dataset.envKey) {
    updateEnvValue(target.dataset.envKey, target.value);
    if (target.dataset.envKey === "BOT_LLM_PROVIDER") {
      render();
    }
    return;
  }
  if (target.dataset.envBool) {
    updateEnvValue(target.dataset.envBool, target.checked ? "true" : "false");
    return;
  }
  if (target.dataset.ruleField) {
    updateRuleField(target.dataset.kind, Number(target.dataset.index), target.dataset.ruleField, target.value);
    return;
  }
  if (target.dataset.ruleCapability) {
    updateRuleCapability(target.dataset.kind, Number(target.dataset.index), target.dataset.ruleCapability, target.checked);
    return;
  }
  if (target.dataset.settingsDefaultMode) {
    state.draftSettings.permissions.defaultMode = target.value;
  }
}

appRoot.addEventListener("input", handleFieldMutation);
appRoot.addEventListener("change", handleFieldMutation);

appRoot.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const action = target.dataset.action;
  if (action === "switch-tab") {
    state.activeTab = target.dataset.tab || "features";
    render();
    return;
  }
  if (action === "open-config") {
    await desktopApi.openConfig();
    return;
  }
  if (action === "open-data") {
    await desktopApi.openData();
    return;
  }
  if (action === "open-external") {
    await desktopApi.openExternal(target.dataset.url || "");
    return;
  }
  if (action === "restart-backend") {
    state.busy = true;
    state.error = "";
    state.notice = "";
    render();
    try {
      const bootstrap = await desktopApi.restartBackend();
      state.bootstrap = bootstrap;
      syncDrafts(true);
      state.notice = "后台已重启。";
      await fetchHealth();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.busy = false;
      render();
    }
    return;
  }
  if (action === "save-onboarding") {
    if (!onboardingReady()) {
      state.error = "请先填写 FEISHU_APP_ID、FEISHU_APP_SECRET 和 BOT_LLM_API_KEY。";
      render();
      return;
    }
    await saveAll({
      restartBackend: true,
      nextTab: "features",
      notice: "首启配置已保存，已进入功能添加页面。"
    });
    return;
  }
  if (action === "save-features") {
    await saveAll({
      restartBackend: true,
      notice: "功能配置已保存，后台已按新配置重启。"
    });
    return;
  }
  if (action === "save-permissions") {
    await saveAll({
      restartBackend: false,
      notice: "权限规则已保存。"
    });
    return;
  }
  if (action === "save-abilities") {
    await saveAll({
      restartBackend: true,
      notice: "能力配置已保存，后台已重启。"
    });
    return;
  }
  if (action === "add-rule") {
    const kind = target.dataset.kind;
    state.draftSettings.permissions[kind].push(defaultRule());
    render();
    return;
  }
  if (action === "remove-rule") {
    const kind = target.dataset.kind;
    const index = Number(target.dataset.index);
    state.draftSettings.permissions[kind].splice(index, 1);
    render();
  }
});

async function initialize() {
  state.bootstrap = await desktopApi.bootstrap();
  syncDrafts(true);
  await fetchHealth();
  render();
  window.setInterval(async () => {
    await fetchHealth();
    render();
  }, 15000);
}

initialize().catch((error) => {
  appRoot.innerHTML = `<div class="loading-state">控制台加载失败：${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
});
