# Feishu Bot

一个独立的、适合本地电脑部署的 `Feishu -> SmartKit` 长连接 Bot。

它只做 6 件事：

- 用飞书长连接接收消息，不需要公网 webhook
- 解析命令和少量口语别名
- 调用 SmartKit `/api/bridge/*`
- 用 Bot 侧 LLM 把结果整理成更适合飞书阅读的卡片摘要
- 维护会话 / 线程 / 异步任务状态，支持后续追问和任务补发
- 提供一个不依赖 SmartKit 的轻量聊天模式，并按用户独立保存记忆

## 架构定位

- `smartkit`：唯一事实源，负责日志接口、脱敏、诊断、会话、异步任务
- `feishu-bot`：飞书入口，负责命令解析、消息线程映射、可读化表达
- `openclaw`：继续消费 SmartKit 标准接口，不直接碰日志平台

## 当前能力

- `/help`
- `/trace <trace_id>`
- `/trace-async <trace_id>`
- `/uid <uid> [15m|1h|6h|1d]`
- `/uid-async <uid> [15m|1h|6h|1d]`
- `/job <job_id>`
- `/chat <message>`
- `/memory`
- `/chat-reset`
- 口语别名：`查下 trace xxx`、`帮我看 uid 123456`、`这个任务现在怎样了`
- 私聊连续追问
- 私聊未命中命令时自动进入聊天模式
- 群聊 `@bot` 或 Slash 触发
- 异步任务自动轮询，完成后回帖补发
- 飞书回复默认使用卡片，按“结论 / 原因 / 建议 / 证据”分块展示
- 聊天记忆按用户隔离，不和其他人的上下文混用

## 为什么适合本地部署

因为这里用的是飞书长连接，不是 webhook：

- 不需要公网回调地址
- 不需要内网穿透
- 只要你的电脑能同时访问飞书开放平台和内网 SmartKit 即可
- 适合个人电脑常驻、开发机常驻，或者轻量服务器部署

## 目录结构

- `src/adapter/feishu/`：飞书 SDK 封装与长连接入口
- `src/parser/`：命令和口语解析
- `src/smartkit-client.ts`：SmartKit Bridge API 客户端
- `src/chat-service.ts`：独立聊天与用户记忆
- `src/formatter.ts`：Bot 侧 LLM / 模板可读化
- `src/session-store.ts`：SQLite 会话、线程、幂等、任务状态、聊天记忆
- `src/bot-service.ts`：消息编排与会话控制
- `src/job-poller.ts`：异步任务轮询与结果补发

## 环境准备

1. 复制环境变量：

```bash
cp .env.example .env
```

2. 安装依赖：

```bash
pnpm install
```

3. 填写下面这些最关键配置：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BOT_NAME`
- `SMARTKIT_BASE_URL`
- `SMARTKIT_TOKEN`（如果 SmartKit Bridge 开启了鉴权）
- `BOT_LLM_API_KEY`（如果你要启用独立聊天）

## 环境分层

现在支持按环境覆盖配置：

- 基础配置：`.env`
- 测试覆盖：`.env.test`
- 生产覆盖：`.env.production`
- 也支持自定义：`.env.<BOT_PROFILE>`

例如你可以这样跑测试环境：

```bash
BOT_PROFILE=test pnpm dev
```

生产环境：

```bash
BOT_PROFILE=production pnpm start
```

仓库里已经带了两个示例文件：

- `.env.test.example`
- `.env.production.example`

## 启动

开发模式：

```bash
pnpm dev
```

生产构建：

```bash
pnpm build
pnpm start
```

### 桌面版常用命令（2026-03-09 实测）

- `pnpm dev`：在本地启动长连接与健康检查服务，内部是 `tsx watch src/index.ts`。若 `.env` 里缺少飞书或模型凭据，会在日志里提示 “credentials are missing”，但健康检查端口会照常监听在 `127.0.0.1:3179`。
- `pnpm dev:mac`：启动新的原生 macOS 控制台。它会先执行 `pnpm build` 生成 Node bridge 和后端，再用 `swift run --package-path macos/FeishuBotApp` 拉起固定尺寸的 SwiftUI 桌面壳。
- `pnpm test:mac`：运行原生 macOS 控制台的 Swift 单元测试。
- `pnpm package:mac`：生成原生 `.app` 和 `.dmg`，输出目录为 `dist/native-macos`。
- `pnpm dev:mac:electron`：旧 Electron 壳保留为迁移期备用入口；只有在需要回查老界面或兼容链路时才使用。

启动后会做三件事：

- 建立飞书长连接
- 启动本地任务轮询器
- 启动一个本地健康检查端口（默认 `127.0.0.1:3179`）

## 打包成 macOS App

- 本地调试原生桌面版：

```bash
pnpm dev:mac
```

这会先构建 `dist/desktop-bridge-cli.js` 与 Node 后端，再启动固定尺寸 `1440x900` 的 SwiftUI 控制台。

- 运行 release 模式原生桌面壳：

```bash
pnpm start:mac
```

命令会使用 release 构建的 Swift 可执行文件，并通过 Node bridge 读写 `.env` / `console-settings.json`。

- 打包 DMG：

```bash
pnpm package:mac
```

生成的安装包在 `dist/native-macos`，包括：

- `Feishu Bot.app`
- `Feishu Bot.dmg`

原生 App 会把 Swift 可执行文件、bundled Node runtime、`dist/`、`node_modules/`、bridge 脚本与 `runtime-config.mjs` 一起打进 bundle。配置仍写入用户本地 `Application Support/Feishu Bot`，不会写回安装目录。

- 迁移期保留旧 Electron 壳：

```bash
pnpm dev:mac:electron
pnpm start:mac:electron
pnpm package:mac:electron
```

## 飞书权限建议

应用侧至少需要：

- 机器人能力
- 接收消息 v2.0 事件订阅
- 单聊消息权限
- 群聊 `@机器人` 消息权限（或群组全部消息权限，但 Bot 侧仍只处理 `@bot`/Slash）
- 回复消息权限

## 消息规则

- 私聊：直接支持命令、追问、异步任务查询
- 私聊：普通消息如果没匹配到排障命令，会自动进入聊天模式
- 群聊：必须 `@bot` 或 Slash 才触发
- 群聊追问：默认沿用首条诊断发起人的 `requester_id` 和权限上下文
- Bot 不直接展示 JSON，不直接展示原始日志全文
- `/chat-reset` 只清当前用户自己的聊天记忆，不影响 SmartKit 诊断会话

## 常见消息示例

- `/trace 7f8e9a0b1234`
- `/trace-async 7f8e9a0b1234`
- `/uid 123456 1h`
- `/chat 帮我梳理一下这次改造的风险`
- `/memory`
- `/chat-reset`
- `查下 trace 7f8e9a0b1234`
- `帮我看 uid 123456`
- `你觉得这个方案还缺什么`
- `展开原因`
- `再查过去 1h`
- `这个任务现在怎样了`

## 本地部署建议

如果你要让飞书消息直接打到本机：

1. 本机登录飞书开发者应用对应租户
2. 启动本 Bot 进程并保持在线
3. 飞书事件订阅切换到长连接模式
4. 保证本机能访问：
   - `open.feishu.cn`
   - SmartKit 所在内网地址

这样就不需要让 OpenClaw 或 SmartKit 暴露公网入口。

## 换电脑继续开发

GitHub 仓库只保存源码，不保存你本机已经填好的飞书 / 模型配置，也不保存本地 SQLite 会话数据。要在另一台 Mac 上无缝接着用，需要同时迁移代码和本地运行目录。

1. 旧电脑先备份这个目录：

```bash
$HOME/Library/Application\ Support/Feishu\ Bot
```

这个目录通常至少包含：

- `.env`
- `console-settings.json`
- SQLite 会话与状态数据

2. 新电脑安装基础环境：

- `Node.js >= 20`
- `corepack` / `pnpm 10.23.0`
- `Xcode` 或 `Xcode Command Line Tools`

3. 新电脑拉代码并安装依赖：

```bash
git clone https://github.com/owenshen0907/feishu-bot.git
cd feishu-bot
git checkout main
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install
```

4. 把旧电脑备份出来的运行目录恢复到新电脑：

```bash
mkdir -p "$HOME/Library/Application Support/Feishu Bot"
rsync -a "/path/to/Feishu Bot/" "$HOME/Library/Application Support/Feishu Bot/"
```

5. 恢复完成后，常用命令如下：

```bash
pnpm dev:mac       # 开发模式启动原生 macOS 控制台
pnpm start:mac     # release 模式启动原生控制台
pnpm package:mac   # 重新打包 .app 和 .dmg
pnpm test          # 运行 Node 测试
pnpm test:mac      # 运行 Swift 测试
```

6. 新电脑第一次启动后建议立即验证：

```bash
curl http://127.0.0.1:3179/health
```

如果你已经恢复了 `Application Support/Feishu Bot`，原生控制台应直接进入正式控制台，而不是重新显示首次向导；随后可以在“系统设置”里发送一条飞书测试消息，确认机器人连通性。

## 测试

```bash
pnpm test
pnpm build
```
