# Screencraft AI

AI 辅助屏幕录制与视频编辑平台。录制时提供实时语音教练，录制结束后自动完成分析、剪辑建议和导出。

## 功能

### 录制阶段（实时）
- **屏幕 + 摄像头同录**，支持全屏、窗口、自定义区域
- **AI 实时语音教练**（Socket.io + Gemini Flash）：
  - 语速过快/过慢提醒
  - 语气词检测（um、like、so…）
  - 停顿与单调语调检测
  - 基于关键词的 AI 自动变焦
- **提词器**，支持纯文本与 Markdown 格式
- **AI 缩放画布**（ZoomCanvas），录制过程中可平滑推拉镜头

### 分析阶段（录制完成后）
Gemini 三步流水线自动运行：

| 步骤 | 内容 |
|------|------|
| `streamTranscript` | 生成完整文字稿 |
| `analyzeVisual` + `analyzeSpeech` | 并行：画面质量问题 + 语音问题 |
| `generateEditPlan` | 输出剪辑计划（剪切点、章节、字幕建议）|

### 编辑阶段
- AI 生成剪辑建议，可视化时间轴
- 支持删减、章节标记、字幕生成
- FFmpeg 后端导出，支持 mp4 / webm，720p / 1080p / 4k

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 14 (App Router) + TypeScript |
| 后端 | Fastify + TypeScript |
| 数据库 | PostgreSQL 16 + Drizzle ORM |
| 存储 | Google Cloud Storage |
| AI | Google Gemini 1.5 Flash / Pro |
| 实时通信 | Socket.io |
| 视频处理 | FFmpeg |
| 认证 | NextAuth.js（Google / GitHub OAuth）|
| 构建 | Turborepo + pnpm workspaces |
| 本地基础设施 | Docker Compose |

## 项目结构

```
Screencraft-ai/
├── apps/
│   ├── server/          # Fastify API 服务（端口 4000）
│   └── web/             # Next.js 前端（端口 3000）
├── packages/
│   └── shared/          # 共享 TypeScript 类型
├── Dockerfile.server    # 服务端容器构建
├── Dockerfile.web       # 前端容器构建
└── docker-compose.yml   # 本地开发基础设施
```

## 本地开发

### 前置要求

- [Node.js 20+](https://nodejs.org)
- [pnpm](https://pnpm.io) — `npm install -g pnpm`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 或 Docker Engine

### 第一步：克隆并安装依赖

```bash
git clone <repo-url>
cd Screencraft-ai
pnpm install
```

### 第二步：配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填写以下必填项：

| 变量 | 说明 |
|------|------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com) 申请 |
| `NEXTAUTH_SECRET` | 任意 32 位以上随机字符串，`openssl rand -base64 32` 生成 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | [Google Cloud Console](https://console.cloud.google.com) OAuth 应用 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | [GitHub Developer Settings](https://github.com/settings/developers) OAuth 应用 |

> **本地存储**：`GCS_EMULATOR_HOST=http://localhost:4443` 默认已填好，对应 docker-compose 里的 fake-gcs-server，不需要真实 GCS 即可开发。

### 第三步：启动基础设施

```bash
docker compose up -d
```

启动 PostgreSQL（5432）、GCS 模拟器（4443）、Redis（6379）。

### 第四步：初始化数据库

```bash
pnpm --filter @screencraft/server db:push
```

### 第五步：启动开发服务

```bash
pnpm dev
```

Turborepo 会并行启动前后端：

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:3000 |
| 后端 API | http://localhost:4000 |
| WebSocket | ws://localhost:4000 |
| GCS 模拟器 | http://localhost:4443 |

## 生产部署

### Docker 镜像构建

```bash
# 后端（含 FFmpeg）
docker build -f Dockerfile.server -t screencraft-server .

# 前端
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_SERVER_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=wss://api.example.com \
  -t screencraft-web .
```

### 部署到 Google Cloud Run（推荐）

```bash
# 推送镜像
gcloud builds submit --tag gcr.io/[PROJECT_ID]/server -f Dockerfile.server .
gcloud builds submit --tag gcr.io/[PROJECT_ID]/web    -f Dockerfile.web    .

# 部署
gcloud run deploy screencraft-server \
  --image gcr.io/[PROJECT_ID]/server \
  --set-env-vars DATABASE_URL=...,GEMINI_API_KEY=... \
  --allow-unauthenticated \
  --region us-central1

gcloud run deploy screencraft-web \
  --image gcr.io/[PROJECT_ID]/web \
  --allow-unauthenticated \
  --region us-central1
```

> Cloud Run 上建议用 [Secret Manager](https://cloud.google.com/secret-manager) 管理敏感变量，并通过 Workload Identity 鉴权访问 GCS，无需 `GCS_KEY_FILE`。

### 生产环境变量

生产环境去掉 `GCS_EMULATOR_HOST`（留空或不设置），其余参考 `.env.example`。

## API 概览

### 录制管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/recordings` | 列出所有录制 |
| POST | `/recordings` | 新建录制 |
| GET | `/recordings/:id` | 录制详情 |
| PATCH | `/recordings/:id` | 更新标题/状态 |
| DELETE | `/recordings/:id` | 删除录制 |
| POST | `/recordings/:id/analyze` | 触发 AI 分析（异步，返回 202）|
| GET | `/recordings/:id/analysis` | 获取分析报告 |
| POST | `/recordings/:id/export` | 触发 FFmpeg 导出（异步，返回 202）|

### AI

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/ai/transcript` | SSE 流式生成文字稿 |
| POST | `/ai/suggest` | 基于分析报告生成剪辑建议 |

### WebSocket 事件

**服务端 → 客户端**（实时教练提示）：

| 事件 | 数据 |
|------|------|
| `ai:speech:rate` | `{ wpm, level: 'fast'｜'ok'｜'slow' }` |
| `ai:filler:detected` | `{ word, count }` |
| `ai:pause:detected` | `{ durationMs }` |
| `ai:monotone:detected` | `{ durationMs, suggestion }` |
| `ai:zoom:trigger` | `{ x, y, scale, duration, trigger }` |
| `ai:zoom:reset` | `{ duration }` |
| `ai:blur:toggle` | `{ active, reason }` |

**客户端 → 服务端**：

| 事件 | 数据 |
|------|------|
| `recorder:chunk` | `{ recordingId, index, buffer }` |
| `recorder:control` | `{ action: 'start'｜'pause'｜'stop', recordingId }` |
