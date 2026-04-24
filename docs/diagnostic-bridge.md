# Diagnostic Bridge 接入规范

Feishu Bot 只接入一套诊断接口标准，所有第三方平台都需要实现本文约定的 HTTP 契约，并通过 `http-component-bundle/v1` 描述文件来分发配置。这样可以把“写接口”和“接入机器人”解耦：接口侧只需输出一份 JSON，控制台粘贴后即可保存，并作为独立能力授权到指定用户或群组。旧的 `smartkit-provider-bundle/v1` 仍然兼容导入，但推荐新接入统一使用通用 Schema。

## 1. 接口契约：`diagnostic-bridge/v1`

### 1.1 基础约定

- **Base URL**：形如 `https://diagnostics.example.com`，会写入组件配置；当前也兼容回填到旧的 `SMARTKIT_*` 这一组历史环境变量。
- **Headers**：
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>`（可选，如果未启用鉴权可省略）
  - `X-Bridge-Caller: feishu-bot`（用于链路审计，默认值可在配置里覆盖）
- **响应包裹**：所有接口返回 `BridgeEnvelope` 结构：

```json
{
  "code": "ok",
  "message": "...",
  "trace_id": "诊断链路 TraceId",
  "http_status": 200,
  "data": { ... 任意结构 ... }
}
```

`code` 为 `ok` 或 `accepted` 时视为成功；其它值会被视为失败，错误信息直接展示给运维。

### 1.2 必需资源

| 功能 | Method | Path | 请求体/参数 | 说明 |
| --- | --- | --- | --- | --- |
| Trace 诊断 | `POST` | `/api/bridge/analyze/trace` | `{ "trace_id", "mode", "requester_id", "scope" }` | 同步或异步链路诊断 |
| UID 诊断 | `POST` | `/api/bridge/analyze/uid` | `{ "uid", "mode", "time_range", "requester_id", "scope" }` | 支持 15m/1h/6h/1d 查询 |
| 异步 Job Query | `GET` | `/api/bridge/analyze/jobs/{job_id}` | - | 返回 Job 最新状态及结果 |
| 会话追问 | `POST` | `/api/bridge/conversations/{conversation_id}/followup` | `{ "message", "requester_id", "scope" }` | 对历史诊断继续追问 |
| 会话详情 | `GET` | `/api/bridge/conversations/{conversation_id}` | - | 拉取摘要、历史、允许动作 |

如果暂时只实现诊断查询，未实现追问/会话接口，也需要返回 HTTP 501，让前端能提示“能力未实现”。

### 1.3 示例 `curl`

```bash
curl --location 'http://127.0.0.1:5001/api/log-unlock/v1/query' \
  --header 'Content-Type: application/json' \
  --header 'X-Client-Id: client_example' \
  --header 'Authorization: Bearer <diagnostic-token>' \
  --data '{
  "query": "帮我排查这个请求为什么失败，traceid=trace_demo_123456，用户反馈 media 超时",
  "mode": "all",
  "response_mode": "segment",
  "time_range": "1d",
  "limit": 200
}'
```

该接口返回的 JSON 需要符合 `BridgeEnvelope`，例如：

```json
{
  "code": "ok",
  "message": "日志解锁查询成功。",
  "request_id": "b6a5b8be-8f27-4f9b-9cc4-b8c71643f8f1",
  "data": {
    "trace_id": "trace_demo_123456",
    "mode": "all",
    "segments": [
      { "type": "meta", "title": "检索信息", "content": "TraceId..." }
    ]
  }
}
```

## 2. 配置打包：`http-component-bundle/v1`

所有可接入的诊断平台都需要提供一个 JSON Bundle，供控制台粘贴导入。结构示例：

```json
{
  "schema": "http-component-bundle/v1",
  "provider": {
    "id": "log-unlock",
    "name": "日志解锁",
    "summary": "查询 trace 与 uid 的日志排障接口",
    "usageDescription": "当用户想排查链路失败、超时、报错原因时调用；不适合回答泛知识问题。",
    "examplePrompts": [
      "查一下 trace trace_demo_123456",
      "帮我看 uid 123456 最近 1h 的错误"
    ]
  },
  "interfaces": [
    {
      "schema": "diagnostic-bridge/v1",
      "base_url": "http://127.0.0.1:5001",
      "timeout_ms": 20000,
      "headers": {
        "X-Bridge-Caller": "feishu-bot"
      },
      "auth": {
        "token": "<diagnostic-token>"
      }
    }
  ],
  "targets": {
    "feishu_bot_desktop": {
      "component": {
        "name": "日志解锁",
        "summary": "查询 trace 与 uid 的日志排障接口",
        "usageDescription": "适合日志排障、链路诊断、错误定位。",
        "examplePrompts": [
          "查一下 trace trace_demo_123456",
          "帮我看 uid 123456 最近 1h 的错误"
        ]
      },
      "env": {
        "DIAGNOSTIC_HTTP_BASE_URL": "http://127.0.0.1:5001",
        "DIAGNOSTIC_HTTP_TOKEN": "<diagnostic-token>",
        "DIAGNOSTIC_HTTP_TIMEOUT_MS": "20000",
        "DIAGNOSTIC_HTTP_CALLER": "feishu-bot"
      }
    }
  }
}
```

控制台粘贴后会自动写入 `.env` / `console-settings.json`，并把组件名称、用途说明、调用提示、示例请求一起带入。旧 `smartkit-provider-bundle/v1` 仍可导入，但不会再作为主推格式。

## 3. 接入流程

1. **服务方**：实现上文接口并输出 Bundle JSON，必要时附带测试用 `curl` 命令，方便接入方验证。
2. **接入方**：在 Feishu Bot 桌面控制台 →「能力配置」→「自定义 HTTP 组件」，粘贴 JSON，点击“解析到当前组件”并测试连通性，再决定是否打开这个组件的总开关。
3. **授权**：保存后到「群组」或「用户」页，直接打开对应对象，看当前已拥有 / 未拥有的能力，把对应能力卡片上的开关打开即可。每个组件都会以独立能力出现，配置自动保存，并在下一条消息立即生效。基础聊天默认开启。
4. **分享配置**：同一个 Bundle 可以反复粘贴到多台机器；如果要更新 Token、用途说明或示例，只需更新 JSON 再次粘贴。

## 4. FAQ

- **Q: 可以自定义 Headers 吗？** 可以，在 `interfaces[].headers` 中声明即可；控制台会把它们映射到组件配置和兼容环境变量。
- **Q: 需要多 Endpoint 吗？** 最少实现 Trace / UID 二个资源，完整体验建议连同 Job 与 Conversation 接口一起实现。
- **Q: 一个机器人能接多个组件吗？** 可以。每个组件都是一条独立能力，用户和群组可以分别打开或关闭授权开关。
- **Q: 旧格式还能用吗？** 可以，`smartkit-provider-bundle/v1` 仍兼容导入；但新接入建议统一使用 `http-component-bundle/v1`。

将本文档连同示例 JSON 与 curl 发给第三方，就可以做到“复制配置 → 粘贴 → 保存 → 授权”式的极速对接。
