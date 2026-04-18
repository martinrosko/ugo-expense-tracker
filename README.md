# Ugo — Personal Finance Tracker

## Architecture Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend    │────▶│  PostgreSQL   │
│  (React/Vite)│     │ (Express/TS) │     │              │
│  :5173       │     │  :3000       │     │  :5432       │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │   Keycloak   │
                     │  (Auth/SSO)  │
                     │  :8080       │
                     └──────────────┘
```

All services run in Docker via `docker-compose.yml`.

## Monorepo Structure

```
UgoBackend/
├── docker-compose.yml
├── package.json                  ← npm workspace root
├── tsconfig.json                 ← project references
│
├── packages/
│   ├── frontend/                 ← React SPA (Vite + Ant Design)
│   │   ├── src/
│   │   │   ├── api/              Resco OData client + entity APIs
│   │   │   ├── assets/           Sample CSV, metadata
│   │   │   ├── components/       AppLayout
│   │   │   ├── features/
│   │   │   │   ├── csv/          CSV parser (VÚB bank format)
│   │   │   │   └── matching/     Transaction matcher + rules
│   │   │   ├── pages/            Upload, Review, Resco Test
│   │   │   └── types/            Resco-specific interfaces
│   │   ├── vite.config.ts
│   │   └── package.json          @ugo/frontend
│   │
│   ├── backend/                  ← REST API (Express + Prisma)
│   │   ├── src/
│   │   │   ├── index.ts          Express app entry
│   │   │   ├── db.ts             Prisma client singleton
│   │   │   └── middleware/
│   │   │       └── auth.ts       Keycloak JWT validation
│   │   ├── prisma/
│   │   │   └── schema.prisma     Database schema
│   │   ├── Dockerfile
│   │   └── package.json          @ugo/backend
│   │
│   └── shared/                   ← Shared TypeScript types
│       ├── src/
│       │   └── index.ts          Domain enums + interfaces
│       └── package.json          @ugo/shared
│
└── keycloak/
    └── realm-export.json         Pre-configured "ugo" realm
```

## Database Schema (ER Diagram)

```
┌─────────────────┐
│  BusinessUnit   │
├─────────────────┤
│ id (PK)         │
│ name            │
└────────┬────────┘
         │ 1
         │
         │ *
┌────────▼────────┐
│      User       │
├─────────────────┤       ┌─────────────────┐
│ id (PK)         │──────▶│    Account      │
│ email           │  1:*  ├─────────────────┤
│ name            │       │ id (PK)         │
│ businessUnitId  │       │ name            │
└────────┬────────┘       │ type (enum)     │
         │                │ initialBalance  │
         │ 1:*            │ isDefault       │
         │                │ ownerId (FK)    │
┌────────▼────────┐       └───────┬─────────┘
│      Tag        │               │
├─────────────────┤               │
│ id (PK)         │       ┌───────▼─────────┐
│ name            │       │   BankTicket    │
│ color           │       ├─────────────────┤
│ ownerId (FK)    │       │ id (PK)         │
└────────┬────────┘       │ amount          │
         │                │ executedOn      │
         │                │ partnerName     │
         │                │ reference       │
         │                │ ticketId (UQ)   │
         │                │ accountId (FK)  │
         │                └───────┬─────────┘
         │                        │ 1:0..1
         │                        │
         │                ┌───────▼─────────┐
         │                │  Transaction    │
         │  *:*           ├─────────────────┤
         ├───────────────▶│ id (PK)         │
         │  (via          │ name            │
         │  TransactionTag│ amount          │
         │  junction)     │ plannedAmount   │
         │                │ type (enum)     │
         │                │ bankTicketId(FK)│◀── unique (1:1)
         │                │ budgetId (FK)   │
         │                │ fromAccountId   │
         │                │ toAccountId     │
         │                └───────┬─────────┘
         │                        │ *
         │                        │
┌────────▼────────┐       ┌───────▼─────────┐
│ TransactionTag  │       │     Budget      │
├─────────────────┤       ├─────────────────┤
│ id (PK)         │       │ id (PK)         │
│ transactionId   │       │ name            │
│ tagId           │       │ amount          │
│ amount          │       │ planId (FK)     │
│ (UQ: tx+tag)   │       │ defaultAcctId   │
└─────────────────┘       └───────┬─────────┘
                                  │ *
                                  │
                          ┌───────▼─────────┐
                          │      Plan       │
                          ├─────────────────┤
                          │ id (PK)         │
                          │ name            │
                          │ startDate       │
                          │ endDate         │
                          │ intervalType    │
                          │ isTemplate      │
                          │ templateId (FK) │ self-ref
                          │ ownerId (FK)    │
                          └─────────────────┘
```

## Enums

| Enum | Values |
|------|--------|
| `AccountType` | `CASH`, `BANK`, `INVESTMENT`, `PAYMENT_PARTNER` |
| `TransactionType` | `EXPENSE`, `INCOME` |
| `PlanIntervalType` | `ONE_TIME`, `WEEKLY`, `MONTHLY`, `YEARLY` |

## Key Constraints

| Table | Constraint | Purpose |
|-------|-----------|---------|
| `BankTicket` | `@@unique([accountId, ticketId])` | Prevent duplicate CSV imports |
| `Transaction` | `bankTicketId @unique` | 1:1 link to bank ticket |
| `TransactionTag` | `@@unique([transactionId, tagId])` | No duplicate tag assignments |

## Docker Services

| Service | Image | Port | Notes |
|---------|-------|------|-------|
| `postgres` | `postgres:16-alpine` | 5432 | Shared by backend + Keycloak |
| `keycloak` | `keycloak:26` | 8080 | Auto-imports `ugo` realm on first boot |
| `backend` | Custom (Node 22) | 3000 | Runs Prisma migrations on start |
| `frontend` | Dev: Vite / Prod: nginx | 5173 | Not in Docker for dev |

## Commands

| Action | Command |
|--------|---------|
| Start frontend | `npm run dev` |
| Start backend (dev) | `npm run backend:dev` |
| Start Docker infra | `npm run docker:up` |
| Stop Docker infra | `npm run docker:down` |
| Create DB migration | `cd packages/backend && npx prisma migrate dev --name <name>` |
| Apply migrations (prod) | `cd packages/backend && npx prisma migrate deploy` |
| Open Prisma Studio | `cd packages/backend && npx prisma studio` |
| Rebuild Docker images | `npm run docker:build` |

## Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **1** | Monorepo + PostgreSQL + Prisma schema + Docker Compose | ✅ Done |
| **2** | REST CRUD routes + Keycloak JWT auth middleware | Planned |
| **3** | Repoint frontend from Resco OData to own backend | Planned |
| **4** | CSV import + transaction matching (server-side or hybrid) | Planned |
| **5** | Multi-user support, business units, permissions | Planned |
