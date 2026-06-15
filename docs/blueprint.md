# OpenMeet — Implementation Blueprint

## File Tree

```text
openmeet/
├── [L0] package.json                 # Scripts and dependencies
├── [L0] next.config.ts               # Next.js config
├── [L0] tsconfig.json                # TypeScript config
├── [L0] contracts/
│   ├── [L0] api.yaml                 # HTTP contract
│   └── [L0] types.ts                 # Shared API types
├── [L0] docs/
│   ├── [L0] vision.md                # Product intent and anti-spec
│   ├── [L0] architecture.md          # Architecture decisions
│   ├── [L0] blueprint.md             # Implementation map
│   └── [L0] adr/                     # Decision records
├── [L1] src/lib/
│   ├── [L1] config.ts                # Environment and availability config
│   ├── [L1] crypto.ts                # Token encryption
│   ├── [L1] db.ts                    # SQLite schema and queries
│   ├── [L1] google.ts                # Google OAuth/Calendar client
│   └── [L1] scheduler.ts             # Slot calculation and booking lifecycle
├── [L2] src/app/
│   ├── [L2] page.tsx                 # Public booking page
│   ├── [L2] admin/page.tsx           # Owner setup page
│   ├── [L2] cancel/[token]/page.tsx  # Tokenized cancel page
│   └── [L2] api/                     # Route handlers
└── [L2] src/features/booking/        # Booking UI
```

## Module Responsibilities

| Module | Layer | Responsibility |
|--------|-------|----------------|
| `config.ts` | L1 | Parse env vars and scheduling rules. |
| `db.ts` | L1 | Own schema, persistence, booking locks. |
| `google.ts` | L1 | Own OAuth token lifecycle and Calendar API calls. |
| `scheduler.ts` | L1 | Generate slots, check conflicts, book/cancel. |
| `api/*` | L2 | Validate HTTP input and return typed responses. |
| `BookingApp.tsx` | L2 | Interactive booking experience. |

## Implementation Sequence

1. Foundation: package, env, docs, contracts.
2. Persistence: SQLite schema and token encryption.
3. Google integration: OAuth, FreeBusy, event insert/delete.
4. Scheduler: slot generation, buffer, conflict checks, pending locks.
5. UI: public page, admin page, cancel page.
6. Verification: typecheck, build, browser smoke test.

## Testing Strategy

| Layer | Test Type | Coverage Target |
|-------|-----------|-----------------|
| L0 | Typecheck/build | Contracts compile and routes build. |
| L1 | Unit/integration later | Scheduler edge cases around time zones. |
| L2 | Browser smoke | Booking page loads and setup state is clear. |

## CLAUDE.md Rules for This Project

- Keep Google Calendar access inside `src/lib/google.ts`.
- Keep booking correctness inside `src/lib/scheduler.ts`.
- API routes must stay thin and validate with Zod.
- Do not add SaaS features unless the anti-spec is revised.
