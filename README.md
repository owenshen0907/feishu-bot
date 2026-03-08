# Feishu Bot

一个独立的、适合本地电脑部署的 `Feishu -> SmartKit` 长连接 Bot。

它只做 5 件事：

- 用飞书长连接接收消息，不需要公网 webhook
- 解析命令和少量口语别名
- 调用 SmartKit `/api/bridge/*`
- 用 Bot 侧 LLM 把结果整理成更适合飞书阅读的短文本
- 维护会话 / 线程 / 异步任务状态，支持后续追问和任务补发

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
- 口语别名：`查下 trace xxx`、`帮我看 uid 123456`、`这个任务现在怎样了`
- 私聊连续追问
- 群聊 `@bot` 或 Slash 触发
- 异步任务自动轮询，完成后回帖补发

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
- `src/formatter.ts`：Bot 侧 LLM / 模板可读化
- `src/session-store.ts`：SQLite 会话、线程、幂等、任务状态
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

启动后会做三件事：

- 建立飞书长连接
- 启动本地任务轮询器
- 启动一个本地健康检查端口（默认 `127.0.0.1:3179`）

## 飞书权限建议

应用侧至少需要：

- 机器人能力
- 接收消息 v2.0 事件订阅
- 单聊消息权限
- 群聊 `@机器人` 消息权限（或群组全部消息权限，但 Bot 侧仍只处理 `@bot`/Slash）
- 回复消息权限

## 消息规则

- 私聊：直接支持命令、追问、异步任务查询
- 群聊：必须 `@bot` 或 Slash 才触发
- 群聊追问：默认沿用首条诊断发起人的 `requester_id` 和权限上下文
- Bot 不直接展示 JSON，不直接展示原始日志全文

## 常见消息示例

- `/trace 7f8e9a0b1234`
- `/trace-async 7f8e9a0b1234`
- `/uid 123456 1h`
- `查下 trace 7f8e9a0b1234`
- `帮我看 uid 123456`
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

## 测试

```bash
pnpm test
pnpm build
```
