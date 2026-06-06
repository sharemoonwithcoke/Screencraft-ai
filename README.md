# Screencraft AI

AI-powered screen recording and video editing platform. Provides real-time speech coaching during recording, then automatically generates a timestamped transcript, visual + audio issue analysis, chapter markers, and a deterministic edit plan the moment recording ends.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Feature Set](#feature-set)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [WebSocket Protocol](#websocket-protocol)
- [AI Pipeline — Deep Dive](#ai-pipeline--deep-dive)
- [Recording & Chunked Upload Flow](#recording--chunked-upload-flow)
- [Edit Plan Generation](#edit-plan-generation)
- [FFmpeg Export Pipeline](#ffmpeg-export-pipeline)
- [Key Data Types](#key-data-types)
- [Production Deployment](#production-deployment)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Browser (Next.js 14 App Router)                         │
│                                                          │
│  MediaRecorder → 5s chunks → Socket.io ──────────────┐  │
│  ImageCapture  → JPEG frames                         │  │
│  Web Speech API → live CC transcript                 │  │
│  /api/ai/stuck-hint  (Next.js route → Gemini)        │  │
└──────────────────────────────────────────────────────│──┘
                                                       │ Socket.io (ws)
┌──────────────────────────────────────────────────────▼──┐
│  Fastify Server (port 4000)                              │
│                                                          │
│  recorder:chunk → GCS upload → analyzeAudioChunk ──►    │
│                                    ai:speech:rate ◄──   │
│                                    ai:filler:detected ◄─┤
│                                    ai:pause:detected  ◄─┘
│                                                          │
│  POST /recordings/:id/analyze                            │
│    streamTranscript ──────────────────────────────────►  │
│    analyzeVisual + analyzeSpeech + generateChapters (‖)  │
│    generateEditPlan (deterministic TS)                   │
│    → analysis_reports table                              │
│                                                          │
│  POST /recordings/:id/export                             │
│    FFmpegService.exportRecording()                       │
└──────────────────────────────────────────────────────────┘
         │                    │
    PostgreSQL 16         Google Cloud Storage
    (Drizzle ORM)         (fake-gcs-server in dev)
```

---

## Feature Set

### During Recording (Real-Time)

- **Multi-source capture** — screen (fullscreen / window / custom region) + optional camera overlay + microphone audio combined into a single `MediaStream`
- **5-second chunked upload** — `MediaRecorder` emits `dataavailable` every 5 s; each chunk is sent as an `ArrayBuffer` over Socket.io and stored to GCS immediately
- **Real-time AI speech coaching** — every chunk is analysed by `gemini-2.5-flash` (`analyzeAudioChunk`) within the same 5 s window:
  - Words-per-minute (WPM) via 10-second sliding window average
  - Filler word detection (`um`, `uh`, `like`, `so`, `you know`)
  - Pause detection (>3 s silence)
  - Monotone delivery detection
  - `warn_speed` emitted when WPM > 150 (computed in code, not delegated to model)
- **Stuck-hint generator** — if silence exceeds 3 s, the frontend captures a JPEG screenshot of the recording viewport, sends it with the full live-CC transcript and teleprompter script to `/api/ai/stuck-hint`; Gemini returns a 1–2-sentence contextual hint in the style appropriate for the video type (sales engineer / senior engineer / patient instructor / presentation coach)
- **Teleprompter** — auto-scrolls with speaker, highlights current line; raw script can be AI-optimised into timed lines with action hints via `optimizeScript`
- **Live closed captions** — Web Speech API (`useLiveCC` hook); full rolling transcript feeds into stuck-hint context
- **Auto-blur** — server detects phrases like "hold on" / "wait" in live transcript and emits `ai:blur:toggle` to blur the broadcast stream

### After Recording (Analysis Pipeline)

Three Gemini agents run as a fire-and-forget async job:

| Step | Function | Output |
|------|----------|--------|
| 1 | `streamTranscript` | Async generator of `[MM:SS] text` lines |
| 2a (parallel) | `analyzeVisual` | `visual_issues[]` with start/end/type/severity/confidence |
| 2b (parallel) | `analyzeSpeech` | `audio_issues[]` with same structure |
| 2c (parallel) | `generateChapters` | `chapters[]` with start timestamp, 3–5-word title, summary |
| 3 | `generateEditPlan` | Deterministic edit instructions (no LLM call) |

All results are persisted to `analysis_reports.issuesJson` and the recording status is set to `"ready"`.

### Editing & Export

- **AI Edit Studio** — React component visualising the edit plan as an instruction list + interactive chapter timeline below the video player; chapters are clickable (seek on click, highlight active chapter)
- **Chapter title cards** — off by default; toggled via checkbox, count shown in UI when enabled
- **FFmpeg export** — async job, transcodes to MP4 (libx264 + AAC) or WebM (libvpx-vp9 + libopus) at 720p / 1080p / 4K; `+faststart` flag enabled for streaming delivery
- **Script optimiser** — `optimizeScript(userScript, videoType, audience)` breaks any raw script into 15-word-max timed lines with emphasis markers and mouse action hints; prompt adapts per video type

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Next.js (App Router) | 14.2.0 |
| Frontend language | TypeScript | 5.4.0 |
| UI | Tailwind CSS + Lucide icons | 3.4.0 |
| Auth | NextAuth.js | 4.24.0 |
| Backend | Fastify | 4.27.0 |
| ORM | Drizzle ORM | 0.30.0 |
| Database | PostgreSQL | 16 |
| Object storage | Google Cloud Storage | SDK 7.12.0 |
| AI model | Google Gemini 2.5 Flash | — |
| Gemini SDK | `@google/generative-ai` | latest |
| File upload to Gemini | `@google/generative-ai/server` (`GoogleAIFileManager`) | — |
| Real-time | Socket.io | 4.7.0 (client + server) |
| Video processing | FFmpeg via `fluent-ffmpeg` | 2.1.3 |
| Monorepo | Turborepo + pnpm workspaces | pnpm 9.0.0 |
| Node.js | — | ≥ 20.0.0 |
| Local infrastructure | Docker Compose | — |

---

## Repository Structure

```
Screencraft-ai/
├── apps/
│   ├── server/                        # Fastify backend (port 4000)
│   │   ├── src/
│   │   │   ├── index.ts               # Server entry point, Socket.io setup, CORS
│   │   │   ├── db/
│   │   │   │   ├── index.ts           # Drizzle client (PostgreSQL)
│   │   │   │   ├── schema.ts          # All table definitions
│   │   │   │   └── migrations/        # Drizzle-kit generated SQL migrations
│   │   │   ├── routes/
│   │   │   │   ├── recordings.ts      # CRUD + analyze + export + edit-session
│   │   │   │   └── ai.ts             # /ai/transcript SSE + /ai/suggest
│   │   │   └── services/
│   │   │       ├── gemini.ts          # All Gemini interactions (1200+ lines)
│   │   │       ├── ffmpeg.ts          # Chunk assembly + export
│   │   │       ├── storage.ts         # GCS upload/download
│   │   │       └── ai-cue.ts          # Real-time coaching orchestration
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   └── web/                           # Next.js 14 frontend (port 3000)
│       ├── src/
│       │   ├── app/                   # App Router pages + API routes
│       │   │   ├── page.tsx           # Landing page
│       │   │   ├── auth/
│       │   │   │   ├── login/
│       │   │   │   └── register/
│       │   │   ├── recorder/          # Main recording UI
│       │   │   ├── dashboard/         # Recording list
│       │   │   ├── recordings/[id]/   # Detail / analysis / edit pages
│       │   │   └── api/
│       │   │       ├── auth/          # NextAuth + /register
│       │   │       ├── recordings/    # Proxy to Fastify + /analyze
│       │   │       └── ai/
│       │   │           ├── stuck-hint/    # Screenshot + transcript → hint
│       │   │           ├── optimize-script/
│       │   │           ├── transcript/
│       │   │           ├── script-suggest/
│       │   │           └── edit-plan/
│       │   ├── components/
│       │   │   ├── recorder/          # RecorderShell, Teleprompter, CameraPreview,
│       │   │   │                      #   AICueOverlay, ZoomCanvas, WaveformPreview
│       │   │   ├── recordings/        # VideoPlayer, AIEditStudio, AnalysisCard,
│       │   │   │                      #   StatusPoller, DownloadButton
│       │   │   ├── analysis/          # AnalysisTrigger, AnalysisReport, ScoreCard
│       │   │   ├── editor/            # EditTimeline, EditSuggestions
│       │   │   └── auth/              # LoginForm, RegisterForm
│       │   ├── hooks/
│       │   │   ├── useRecorder.ts     # MediaRecorder state machine
│       │   │   ├── useScreenCapture.ts # ImageCapture + frame diff + region crop
│       │   │   ├── useWebSocket.ts    # Socket.io client + chunk sender
│       │   │   ├── useLiveCC.ts       # Web Speech API live captions
│       │   │   ├── useTeleprompter.ts # Line tracking + auto-scroll
│       │   │   ├── useScriptSuggestions.ts # SSE teleprompter suggestions
│       │   │   ├── useFFmpegEdit.ts   # Edit/export trigger
│       │   │   └── useZoomPan.ts      # Smooth zoom/pan during recording
│       │   └── lib/
│       │       ├── auth.ts            # NextAuth config (Google + GitHub OAuth)
│       │       ├── cn.ts              # clsx Tailwind helper
│       │       ├── videoStore.ts      # sessionStorage blob cache
│       │       ├── dev-auth.ts        # Dev session mock
│       │       └── dev-store.ts       # In-memory mock DB for dev
├── docker-compose.yml                 # PostgreSQL 16 + fake-gcs-server + Redis 7
├── Dockerfile.server
├── Dockerfile.web
├── turbo.json                         # dev (no-cache, persistent), build, lint, type-check
└── package.json                       # pnpm 9.0.0, Node ≥ 20
```

---

## Local Development

### Prerequisites

- [Node.js 20+](https://nodejs.org)
- [pnpm](https://pnpm.io) — `npm install -g pnpm`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine

### Step 1 — Install dependencies

```bash
git clone <repo-url>
cd Screencraft-ai
pnpm install
```

### Step 2 — Configure environment variables

```bash
cp .env.example .env
```

See [Environment Variables](#environment-variables) for the full reference.

### Step 3 — Start local infrastructure

```bash
docker compose up -d
```

Starts:
- **PostgreSQL 16** on port `5432`, database `screencraft`
- **fake-gcs-server** on port `4443` (Google Cloud Storage emulator)
- **Redis 7** on port `6379`

All services use named Docker volumes for data persistence across restarts.

### Step 4 — Push database schema

```bash
pnpm --filter @screencraft/server db:push
```

This runs `drizzle-kit push` which applies the schema in `apps/server/src/db/schema.ts` directly to the local PostgreSQL instance. For production, use `db:generate` + `db:migrate` instead.

### Step 5 — Start dev servers

```bash
pnpm dev
```

Turborepo starts both apps in parallel:

| Service | URL |
|---------|-----|
| Frontend (Next.js) | http://localhost:3000 |
| Backend API (Fastify) | http://localhost:4000 |
| WebSocket | ws://localhost:4000 |
| GCS emulator | http://localhost:4443 |
| Drizzle Studio | `pnpm db:studio` → http://local.drizzle.studio |

---

## Environment Variables

### Web (`apps/web/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SERVER_URL` | ✓ | Fastify API base URL, e.g. `http://localhost:4000` |
| `NEXT_PUBLIC_WS_URL` | ✓ | WebSocket URL, e.g. `ws://localhost:4000` |
| `GEMINI_API_KEY` | ✓ | Google AI Studio key — used by Next.js API routes (`/api/ai/stuck-hint` etc.) |
| `NEXTAUTH_SECRET` | ✓ | ≥32-char random string — `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✓ | Full base URL of the web app, e.g. `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | ✓ | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | ✓ | Google OAuth 2.0 client secret |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth app client ID (optional) |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth app client secret (optional) |

### Server (`apps/server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✓ | PostgreSQL connection string, e.g. `postgresql://postgres:postgres@localhost:5432/screencraft` |
| `GEMINI_API_KEY` | ✓ | Same Google AI Studio key — used for all Gemini calls in `GeminiService` |
| `GCS_PROJECT_ID` | ✓ | Google Cloud project ID |
| `GCS_BUCKET` | ✓ | GCS bucket name |
| `GCS_EMULATOR_HOST` | dev | `http://localhost:4443` — set this to route GCS traffic to fake-gcs-server; unset in production |
| `GCS_KEY_FILE` | prod | Path to GCP service account JSON key; not required when using Workload Identity on Cloud Run |
| `PORT` / `SERVER_PORT` | — | Fastify listen port (default `4000`) |
| `NODE_ENV` | — | `development` or `production` |
| `NEXT_PUBLIC_APP_URL` | ✓ | CORS allowed origin for the web frontend, e.g. `http://localhost:3000` |

---

## Database Schema

All tables are defined in `apps/server/src/db/schema.ts` using Drizzle ORM with PostgreSQL dialect.

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `randomUUID()` |
| `email` | `varchar(255)` UNIQUE NOT NULL | |
| `name` | `varchar(255)` | |
| `plan` | `enum(free, pro, enterprise)` | default `free` |
| `createdAt` | `timestamp` | default `now()` |
| `updatedAt` | `timestamp` | |

### `recordings`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `userId` | `uuid` FK → `users.id` | |
| `title` | `varchar(200)` NOT NULL | |
| `status` | `enum(idle, recording, paused, processing, ready, error)` | default `idle` |
| `duration` | `integer` | seconds |
| `resolution` | `varchar(20)` | e.g. `1920x1080` |
| `thumbnailUrl` | `text` | GCS signed URL |
| `createdAt` | `timestamp` | |
| `updatedAt` | `timestamp` | |

### `recording_chunks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `recordingId` | `uuid` FK → `recordings.id` | CASCADE DELETE |
| `index` | `integer` NOT NULL | Chunk sequence number |
| `s3Key` | `text` | GCS object path, e.g. `recordings/{id}/chunks/{n}.webm` |
| `duration` | `integer` | seconds |
| `createdAt` | `timestamp` | |

### `analysis_reports`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `recordingId` | `uuid` FK → `recordings.id` | |
| `score` | `jsonb` | Score breakdown (reserved for future model) |
| `issuesJson` | `jsonb` | `{ visual_issues, audio_issues, edit_plan, chapters }` |
| `createdAt` | `timestamp` | |

### `edit_sessions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `recordingId` | `uuid` FK → `recordings.id` | |
| `cutsJson` | `jsonb` | Applied cut list |
| `chaptersJson` | `jsonb` | Chapter markers |
| `exportsJson` | `jsonb` | Export job metadata |
| `subtitleUrl` | `text` | |
| `highlightExportUrl` | `text` | |
| `createdAt` / `updatedAt` | `timestamp` | |

### `teleprompter_scripts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `recordingId` | `uuid` FK → `recordings.id` | |
| `content` | `text` | Full script text |
| `format` | `enum(plaintext, markdown)` | |
| `createdAt` | `timestamp` | |

### `ai_events`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `recordingId` | `uuid` FK | |
| `eventType` | `varchar` | e.g. `speech:rate`, `filler:detected` |
| `timestampMs` | `bigint` | |
| `payload` | `jsonb` | Full event data |
| `createdAt` | `timestamp` | |

---

## API Reference

All Fastify routes are mounted at the root; the web app Next.js API routes (`/api/*`) proxy to Fastify or call Gemini directly.

### Recordings (Fastify)

| Method | Path | Status | Body / Response |
|--------|------|--------|-----------------|
| `GET` | `/recordings` | 200 | `{ ok, data: Recording[] }` |
| `POST` | `/recordings` | 201 | Body: `{ title, region, resolution?, teleprompterContent? }` |
| `GET` | `/recordings/:id` | 200 / 404 | `{ ok, data: Recording }` |
| `PATCH` | `/recordings/:id` | 200 | Body: `{ title?, status? }` — partial update |
| `DELETE` | `/recordings/:id` | 204 | — |
| `POST` | `/recordings/:id/analyze` | 202 | Body: `{ transcript?, videoType?, audienceType? }` — triggers async pipeline |
| `GET` | `/recordings/:id/analysis` | 200 / 404 | `{ ok, data: AnalysisReport }` |
| `POST` | `/recordings/:id/export` | 202 | Body: `{ format: "mp4"|"webm", quality: "720p"|"1080p"|"4k", includeCaptions? }` |
| `GET` | `/recordings/:id/edit-session` | 200 / 404 | `{ ok, data: EditSession }` |

### AI (Fastify)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ai/transcript` | SSE stream of `[MM:SS] text` lines from `streamTranscript` |
| `POST` | `/ai/suggest` | Re-runs `generateEditPlan` from stored analysis report; body: `{ recordingId }` |

### AI (Next.js API routes, call Gemini directly)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ai/stuck-hint` | FormData: `screenshot` (File), `spokenSoFar`, `currentScriptLine`, `fullScript`, `videoType` → `StuckHint` |
| `POST` | `/api/ai/optimize-script` | Body: `{ script, videoType, audience }` → `{ script_lines[], total_estimated_seconds }` |
| `POST` | `/api/ai/edit-plan` | Body: `{ recordingId }` → `EditPlan` |
| `GET`  | `/api/ai/transcript` | SSE — proxies `streamTranscript` from Fastify |
| `POST` | `/api/ai/script-suggest` | Real-time teleprompter suggestions on screen change/pause |

### Auth (Next.js)

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/api/auth/[...nextauth]` | NextAuth.js handler (Google OAuth, credentials) |
| `POST` | `/api/auth/register` | New user registration |

---

## WebSocket Protocol

Socket.io namespace: `/` (default)

**Authentication**: `socket.handshake.auth.recordingId`

**Client joins room** `recording:{recordingId}` on connect.

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `recorder:chunk` | `{ blob: ArrayBuffer, timestamp: number, index: number, recordingId: string }` | Raw 5-second audio/video chunk |
| `recorder:control` | `{ action: "start" \| "pause" \| "resume" \| "stop", recordingId: string }` | Recording lifecycle control |

### Server → Client (emitted to `recording:{recordingId}`)

| Event | Payload | Description |
|-------|---------|-------------|
| `ai:speech:rate` | `{ wpm: number, level: "fast" \| "ok" \| "slow" }` | Per-chunk WPM + threshold level |
| `ai:filler:detected` | `{ word: string, count: number }` | Triggered when filler word seen ≥3 consecutive times |
| `ai:pause:detected` | `{ durationMs: 3500 }` | Meaningful silence detected |
| `ai:monotone:detected` | `{ durationMs: number, suggestion: string }` | Low pitch variation |
| `ai:blur:toggle` | `{ active: boolean, reason: "hold_on" }` | Auto-blur on "hold on" / "wait" phrases |

---

## AI Pipeline — Deep Dive

All Gemini interactions are encapsulated in `GeminiService` (`apps/server/src/services/gemini.ts`).

### Model Configuration

Every method creates a `getGenerativeModel` instance with:
- `model: "gemini-2.5-flash"`
- `generationConfig.responseMimeType: "application/json"`
- `generationConfig.responseSchema` (typed Gemini schema — every call uses structured output, no freeform text parsing)

### Gemini Files API — Upload Cache

Video upload is expensive (~10–30 s for large files). `GeminiService` deduplicates uploads with a two-level cache:

```typescript
// 47-hour TTL matches Gemini Files API validity window
private fileUriCache = new Map<string, { promise: Promise<string>; expiresAt: number }>();
// recordingId → Gemini file name (e.g. "files/abc123") for cleanup
private fileNameCache = new Map<string, string>();
```

`uploadRecordingToGemini(recordingId)` returns the cached promise if it hasn't expired. `analyzeVisual` and `streamTranscript` (called back-to-back in the pipeline) both call this method — only one upload occurs regardless of call order.

`_doUpload` wraps `_doUploadOnce` with 3 attempts and exponential backoff (2 s, 4 s). After a successful upload, the file's `state` is polled every 3 s until it leaves `PROCESSING` state.

`cleanupRecording(recordingId)` deletes the Gemini file using the cached file name and clears both cache entries. Called after the full analysis pipeline completes to free quota.

### `analyzeAudioChunk` — Unified Real-Time Analysis

**Input**: Raw audio `Buffer` (WebM, ~5 s)

**Gemini prompt instructs the model to return**:
```json
{
  "action": "next_line" | "reset_position" | null,
  "at_second": 3.2 | null,
  "message": "≤8 words" | null,
  "wpm": 142,
  "fillerWords": ["um", "uh"],
  "pauseDetected": false,
  "monotone": false,
  "transcript": "exact words spoken"
}
```

`action: "warn_speed"` is **not** delegated to the model — it is computed in TypeScript code after the Gemini response:
```typescript
if (!out.action && out.wpm > 150) {
  out.action = "warn_speed";
  out.message = "Slow down a little";
}
```

This replaced two separate legacy methods (`streamLiveCoach` + `analyzeSpeechChunk`) which both consumed the same audio buffer, doubling latency and API cost.

### `generateStuckHint` — Contextual Hint During Silence

**Signature**:
```typescript
generateStuckHint(
  screenshotBuffer: Buffer,
  spokenSoFar: string,         // full CC transcript since recording started
  currentScriptLine: string,   // first non-empty line of remaining script
  fullScript: string,          // entire prepared teleprompter script
  videoType: string,           // PRODUCT_DEMO | TECHNICAL_DEMO | TUTORIAL | PRESENTATION
  mimeType: "image/jpeg" | "image/png" = "image/jpeg"
): Promise<StuckHint>
```

The prompt uses three sources of context (screenshot + spoken transcript + full script) and **adapts its persona per video type**:

| Video Type | Prompt Persona |
|------------|---------------|
| `PRODUCT_DEMO` | Confident sales engineer — highlights value and benefit language |
| `TECHNICAL_DEMO` | Senior engineer — precise, step-oriented, no oversimplification |
| `TUTORIAL` | Patient instructor — sequential, reassuring, one concrete step at a time |
| `PRESENTATION` | Presentation coach — focuses on narrative and storytelling flow |

Returns `hint: null` when the screenshot is blank, loading, or shows an error state.

### `streamTranscript` — Chunked Timestamped Transcript

Returns an `AsyncGenerator<string>` that yields `[MM:SS] text` lines as they arrive from Gemini's streaming API. Raw chunks are buffered internally so callers never receive a split mid-token timestamp marker:

```typescript
let buffer = "";
for await (const chunk of result.stream) {
  buffer += chunk.text();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";          // keep incomplete line in buffer
  for (const line of lines) {
    if (line.trim()) yield line + "\n";
  }
}
if (buffer.trim()) yield buffer;        // flush remainder
```

### `analyzeVisual` — Frame-by-Frame Visual Analysis

**Input**: Gemini file URI (video uploaded via Files API)

**Prompt structure**:
1. **EDITORIAL GOAL BY VIDEO TYPE** — anchors the model's overall edit objective before any specific rule (e.g. PRODUCT_DEMO: "cut anything that makes the presenter look hesitant"; TUTORIAL: "never cut a step even if it seems slow")
2. **Per-type quality standards** — specific thresholds for each of PRODUCT_DEMO / TECHNICAL_DEMO / TUTORIAL / PRESENTATION
3. **DEFINITION OF ISSUE TYPES** — quantified thresholds:
   - `"erratic mouse"`: cursor moves >30% screen width in 1 s, or changes direction >3 times in 2 s without clicking
   - `"no zoom"`: UI element <15% screen width being discussed without 1.5 s dwell or zoom
   - Duplicate demo detection (same UI element demonstrated twice within 60 s)
4. **MAXIMUM DELETION LENGTH** — 8 s cap per segment; segments longer than 8 s must be noted for manual review or narrowed to a 1–3 s sub-segment; 5 s of continuous fluent speech is always protected
5. **SCREEN CHANGE PROTECTION** — ±3 s window around any screen change is protected; segments spanning a change are discarded entirely
6. **LONG STATIC PAUSE DELETION** — >10 s of no visual change + no speech = `"dead pause"` type, severity `"high"`; 5–10 s = severity `"medium"`; AI wait states (loading spinner / progress bar) are exempted
7. **CRITICAL BOUNDARY RULES** — start/end must align with sentence boundaries; no overlapping issue entries
8. **CONTINUITY CHECK** — transition phrases, context anchors, question-answer pairs all protected

**Response schema** (structured output):
```typescript
{ visual_issues: VisualIssue[] }

interface VisualIssue {
  start: string;        // "M:SS"
  end: string;          // "M:SS"
  type: "erratic mouse" | "unexplained click" | "no zoom" | "too fast" |
        "no pause after transition" | "audio-visual mismatch" |
        "insufficient hold" | "skipped context" | "dead pause";
  severity: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  suggestion: string;
}
```

### `analyzeSpeech` — Transcript-Based Speech Analysis

**Input**: Full `[MM:SS]`-timestamped transcript string (from `streamTranscript`)

**Guard**: returns `{ audio_issues: [] }` if fewer than 3 timestamps are present — too sparse for reliable analysis.

**Prompt structure** (mirrors `analyzeVisual`):
1. **EDITORIAL GOAL BY VIDEO TYPE** — same four goal blocks
2. **Speaking rate** — calculated as 10-second sliding window average (not per-sentence); short bursts of fast speech within a slow section are not flagged
3. **Per-type narration standards** — WPM ranges, filler word allowances, pause rules
4. **Multilingual exemption** — language switches never flagged as `"unclear explanation"` or `"jargon without explanation"`
5. **Intentional emphasis rule** — `"very very"` / `"really really"` are rhetorical devices, not repeated phrases; only flag repeated phrases after >0.5 s pause
6. **FILLER & STUTTER REMOVAL RULES**:
   - Tone-invariant grouping: `"uh"` rising / falling / flat = same filler instance
   - Group evaluation: fillers within any 3 s window with combined duration ≥1 s → flag entire group as `"high"`
   - Mandatory `"high"` deletion if: group ≥1 s total in 3 s window; OR filler preceded AND followed by ≥3 s silence; OR group itself ≥3 s
   - FILLER REMOVAL always overrides CONTINUITY CHECK
7. **NARRATION SYNC RULES** — narration >2 s ahead of screen = `"narration ahead of screen"`; >3 s behind = `"narration behind screen"`
8. **SCREEN CHANGE PROTECTION** / **LONG STATIC PAUSE DELETION** / **MAXIMUM DELETION LENGTH** — same rules as `analyzeVisual`
9. **CRITICAL BOUNDARY RULES** — no overlapping entries; filler deletions exempt from sentence-boundary rule

**Response schema**:
```typescript
{ audio_issues: AudioIssue[] }

interface AudioIssue {
  start: string;
  end: string;
  type: "too fast" | "too slow" | "insufficient pause" | "filler words" |
        "unclear explanation" | "restart" | "monotone" |
        "jargon without explanation" | "narration ahead of screen" |
        "narration behind screen" | "stutter" | "repeated phrase" | "dead pause";
  severity: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  suggestion: string;
}
```

### `generateChapters` — Chapter Boundary Detection

Short-circuit: recordings shorter than 90 s return a single `"Full recording"` chapter without an LLM call.

**Prompt adapts chapter granularity per video type**:
- `PRODUCT_DEMO` — 3–6 chapters per product feature / value moment; titles sound like feature names
- `TECHNICAL_DEMO` — chapters map to technical steps reproducible in isolation
- `TUTORIAL` — highly granular (one task per chapter); err toward more chapters
- `PRESENTATION` — chapters map to main arguments / narrative sections

### `optimizeScript` — Script Line Optimisation

**Signature**:
```typescript
optimizeScript(
  userScript: string,
  videoType: string = "PRODUCT_DEMO",
  audience: string = "mixed"
): Promise<{ script_lines: ScriptLine[]; total_estimated_seconds: number }>
```

Breaks raw script into ≤15-word phrases, each with `estimated_seconds`, `action_hint` (mouse movement suggestion), and `emphasis` word list. Prompt style adapts by video type (benefit language for PRODUCT_DEMO, sequential precision for TECHNICAL_DEMO, etc.). Responds in the same language as the input script.

---

## Recording & Chunked Upload Flow

```
Browser                           Fastify                        GCS
───────                           ───────                        ───
MediaRecorder.start(5000)
  │
  ├─dataavailable (5s chunk)
  │  sendChunk(blob, index, id) ──► recorder:chunk event
  │                                 StorageService.uploadChunk()──► recordings/{id}/chunks/{n}.webm
  │                                 INSERT recording_chunks row
  │                                 AiCueService.processChunk()
  │                                   downloadChunk from GCS
  │                                   analyzeAudioChunk(buffer)
  │                                     ← Gemini API response
  │  ◄─ ai:speech:rate ──────────────  emit to room
  │  ◄─ ai:filler:detected ──────────  emit to room (if ≥3 consecutive)
  │  ◄─ ai:pause:detected ───────────  emit to room (if pauseDetected)
  │
  └─ last chunk → user clicks Stop
       recorder:control {action:"stop"}
         FFmpegService.assembleChunks()
           SELECT * FROM recording_chunks ORDER BY index
           downloadChunk() for each ──► concat.txt manifest
           ffmpeg -f concat → output.mp4
           StorageService.uploadOutput() ──► recordings/{id}/output.mp4
```

**Screen region capture** (`useScreenCapture`):

`captureRegionJpeg(cssRect, quality)` maps a CSS bounding rectangle onto actual MediaStream pixel coordinates using the `ImageCapture.grabFrame()` bitmap dimensions:
```typescript
const scaleX = bitmap.width  / window.innerWidth;
const scaleY = bitmap.height / window.innerHeight;
const sx = Math.round(cssRect.left * scaleX);
const sy = Math.round(cssRect.top  * scaleY);
// ... clamp to bitmap bounds, drawImage crop, canvas.toBlob
```

Frame difference detection (`getFrameDiff`) computes pixel-level mean absolute difference between two RGBA bitmaps to detect screen changes for stuck-hint throttling.

---

## Edit Plan Generation

`generateEditPlan` is **pure deterministic TypeScript** — no LLM call. This guarantees reproducibility and precise control over every edit boundary.

**Signature**:
```typescript
generateEditPlan(
  visualIssues:             { visual_issues: VisualIssue[] },
  audioIssues:              { audio_issues: AudioIssue[] },
  recordingDurationSeconds: number,      // extracted from last [MM:SS] in transcript
  screenChangeTimestamps:   number[],    // seconds; reserved for future integration
  chapters?:                ChapterMarker[],
  insertTitleCards?:        boolean      // default false
): EditPlan
```

**Processing steps**:

1. **Merge all issues** — combine `visual_issues` + `audio_issues` into a single array sorted by `parseSecs(start)`

2. **Collect delete candidates** — only `severity === "high"` issues enter the candidate list:
   - `confidence === "low"` audio issues → emit `insert_silence 0.5 s` suggestion instead; skip from candidates
   - `confidence === "low"` visual issues → skip entirely
   - Segments overlapping a screen-change protected window (`screenChangeTimestamps.some(t => s < t + 3 && e > t - 3)`) → skip

3. **Merge adjacent ranges** — candidates sorted by start time; ranges with gap < 2 s are merged into a single segment; `isFiller` is true only when both ranges are filler-type

4. **Apply 50% cap** — greedy accumulation in chronological order; any merged range that would push total deleted seconds past `recordingDurationSeconds × 0.5` is skipped:
   ```typescript
   const maxDeleteSeconds = recordingDurationSeconds > 0 ? recordingDurationSeconds * 0.5 : Infinity;
   ```

5. **Emit instructions**:
   - Each surviving merged range → `{ action: "delete", start, end, reason }`
   - Filler/stutter ranges additionally emit `{ action: "insert_silence", at, duration_seconds: 0.3 }` for a natural-sounding cut
   - Non-high `"insufficient pause"` audio issues → `{ action: "insert_silence", duration_seconds: 1.5 }`
   - `"unclear explanation"` / `"jargon without explanation"` → `{ action: "insert_tts", text: suggestion, voice: "en-US" }`
   - Optional chapter title cards → `{ action: "insert_title_card", at, title, duration_seconds: 2 }`

6. **Sort final instruction list** by `parseSecs(i.start ?? i.at ?? "0:00")`

**Timestamp parsing** (`parseSecs`):
```typescript
function parseSecs(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}
```

**Recording duration extraction** (in `recordings.ts`):
```typescript
const tsMatches = transcript.match(/\[(\d+):(\d+)\]/g) ?? [];
if (tsMatches.length > 0) {
  const lastTs = tsMatches[tsMatches.length - 1].match(/\[(\d+):(\d+)\]/)!;
  recordingDurationSeconds = Number(lastTs[1]) * 60 + Number(lastTs[2]);
}
```

---

## FFmpeg Export Pipeline

**Chunk assembly** (`assembleChunks`):
```
SELECT recording_chunks ORDER BY index
foreach chunk: downloadChunk(s3Key) → /tmp/{id}-{n}.webm
write /tmp/concat-{id}.txt:
  file '/tmp/{id}-0.webm'
  file '/tmp/{id}-1.webm'
  ...
ffmpeg -f concat -safe 0 -i concat.txt -c copy /tmp/output-{id}.mp4
uploadOutput(recordingId, buffer) → GCS recordings/{id}/output.mp4
```

**Export** (`exportRecording`):
```
ffmpeg -i {signed-url}
  [-vf scale=1280:720]        # or 1920:1080 / 3840:2160
  [-c:v libx264 -c:a aac]     # MP4
  [-c:v libvpx-vp9 -c:a libopus] # WebM
  [-movflags +faststart]      # MP4 streaming optimisation
  /tmp/export-{id}-{ts}.{ext}
uploadOutput → GCS recordings/{id}/exports/export-{ts}.{ext}
```

---

## Key Data Types

```typescript
// Edit instruction — one atomic edit operation
interface EditInstruction {
  action: "delete" | "insert_silence" | "insert_tts" | "insert_title_card";
  start?: string;           // "M:SS" — delete range start
  end?: string;             // "M:SS" — delete range end
  at?: string;              // "M:SS" — insert point
  duration_seconds?: number;
  text?: string;            // TTS text or title card text
  title?: string;           // title card display title
  voice?: string;           // TTS voice locale, e.g. "en-US"
  reason?: string;          // concatenated suggestions from merged issues
}

// Returned by generateEditPlan
interface EditPlan {
  edit_instructions: EditInstruction[];
  summary: string;  // e.g. "12 issues found. 3 segments deleted, 2 pauses inserted, 1 TTS added."
}

// Chapter marker
interface ChapterMarker {
  start: string;    // "M:SS"
  title: string;    // 3–5 words
  summary: string;  // one sentence
}

// Stuck-hint response
interface StuckHint {
  hint: string | null;           // null when screenshot is blank/loading/error
  can_insert_to_script: boolean;
  detected_ui: string;           // human-readable description of what's on screen
}

// Unified real-time analysis output (one per 5-second chunk)
interface AudioChunkAnalysis {
  action: "warn_speed" | "next_line" | "reset_position" | null;
  at_second: number | null;
  message: string | null;      // ≤8 words for UI display
  wpm: number;
  fillerWords: string[];
  pauseDetected: boolean;
  monotone: boolean;
  transcript: string;
}

// Optimised script line
interface ScriptLine {
  text: string;
  estimated_seconds: number;
  action_hint: string;         // e.g. "move mouse to settings button"
  emphasis: string[];          // words to speak slowly/clearly
}
```

---

## Production Deployment

### Docker Build

```bash
# Backend (includes FFmpeg in base image)
docker build -f Dockerfile.server -t screencraft-server .

# Frontend (NEXT_PUBLIC_* vars baked at build time)
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_SERVER_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=wss://api.example.com \
  -t screencraft-web .
```

### Google Cloud Run (Recommended)

```bash
# Build + push
gcloud builds submit --tag gcr.io/[PROJECT_ID]/screencraft-server -f Dockerfile.server .
gcloud builds submit --tag gcr.io/[PROJECT_ID]/screencraft-web    -f Dockerfile.web    .

# Deploy server
gcloud run deploy screencraft-server \
  --image gcr.io/[PROJECT_ID]/screencraft-server \
  --set-env-vars DATABASE_URL=...,GEMINI_API_KEY=...,GCS_BUCKET=...,GCS_PROJECT_ID=... \
  --allow-unauthenticated \
  --region us-central1

# Deploy web
gcloud run deploy screencraft-web \
  --image gcr.io/[PROJECT_ID]/screencraft-web \
  --set-env-vars NEXTAUTH_SECRET=...,NEXTAUTH_URL=https://app.example.com \
  --allow-unauthenticated \
  --region us-central1
```

**GCS authentication on Cloud Run**: Use [Workload Identity](https://cloud.google.com/run/docs/securing/service-identity) — attach a service account with `roles/storage.objectAdmin` to the Cloud Run service. Do **not** set `GCS_KEY_FILE` or `GCS_EMULATOR_HOST` in production.

**Secret management**: Store `GEMINI_API_KEY`, `DATABASE_URL`, `NEXTAUTH_SECRET`, and OAuth secrets in [Secret Manager](https://cloud.google.com/secret-manager) and mount them as environment variables via `--set-secrets`.

### Database Migrations (Production)

```bash
# Generate SQL migration files
pnpm --filter @screencraft/server db:generate

# Apply migrations to production DB
pnpm --filter @screencraft/server db:migrate
```

Do **not** use `db:push` in production — it applies schema changes without generating migration files.

### Health Check

```
GET /health → 200 OK
```

Used by Cloud Run / load balancer readiness probes.
