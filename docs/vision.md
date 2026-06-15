# OpenMeet — Vision

## Product Overview

OpenMeet is a personal scheduling page for a single Google Calendar owner. Visitors can pick an available time, submit their contact details, and receive a Google Calendar invite. The app is deliberately single-owner and single-event-type so it stays easy to operate.

## Target Users

- Primary: a calendar owner who needs a self-owned booking link.
- Secondary: external invitees who need a fast, mobile-friendly way to book one call.

## Core Scenarios

1. Visitor books a call: choose a time, enter name/email, confirm.
2. Owner connects Google Calendar: authorize once through the admin page and store refresh token.
3. Visitor cancels: use a tokenized cancel link to remove the local booking and Google event.

## Success Metrics

- A visitor can complete a booking in under 60 seconds.
- Google Calendar conflicts are blocked before booking.
- Owner setup takes one OAuth connection and no manual database work.

## Technical Constraints

- Stack: Next.js App Router, TypeScript, Node 25, SQLite, Google Calendar API.
- Deployment: local first; Railway-compatible if persistent disk and env vars are configured.
- Calendar owner: configured with `OWNER_EMAIL`.
- Source of truth for busy time: Google Calendar FreeBusy plus local pending/confirmed bookings.

## Non-Functional Requirements

- Slot calculation should respond within 500 ms for normal 14-day windows after Google API latency.
- Mobile-first booking UI.
- Token storage must be encrypted at rest with `TOKEN_ENCRYPTION_KEY`.
- Admin OAuth must be protected by `ADMIN_SECRET`.

## Priority Matrix

| Feature | Priority | Phase |
|---------|----------|-------|
| Google OAuth owner connection | P0 | v0.1 |
| FreeBusy-based slot calculation | P0 | v0.1 |
| Booking form and Google event insert | P0 | v0.1 |
| SQLite booking lock | P0 | v0.1 |
| Cancel link | P1 | v0.1 |
| Email provider integration | P2 | Future |
| Multi event types, teams, payments | P2 | Future |

## Anti-Spec

### 禁止引入的复杂度

- 不做团队、round-robin、routing form、支付、CRM webhook。
- 不同步整本日历，不维护本地 event mirror。
- 不做多 event type 配置 UI，首版用环境变量。

### 禁止出现的耦合

- 前端不能直接知道 Google token 或 Calendar API details。
- Booking 页面不能绕过 `/api/book` 直接创建本地记录。
- Google API 逻辑集中在 `src/lib/google.ts`，不要散落到页面组件。

### 禁止过早优化的点

- 不引入 Redis/queue/worker。
- 不做复杂缓存；FreeBusy 实时查。
- 不做完整用户系统；只有 owner OAuth 和公开访客表单。

### 允许未来替换但首版不抽象的点

- SQLite 可换 PostgreSQL。
- Google Calendar 可扩展 Microsoft Calendar。
- 环境变量配置可换 admin 设置页。
