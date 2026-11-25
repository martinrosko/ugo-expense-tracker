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
| `mcp` | Custom (Node 22) | 3001 | MCP server, see below |
| `frontend` | Dev: Vite / Prod: nginx | 5173 | Not in Docker for dev |

## MCP Server (`packages/mcp`)

Lets LLM clients work with Ugo data through MCP tools. It calls the backend REST API with the user's own Keycloak token, so the backend enforces ownership and keeps all business rules (template sync, plan completion, execute/unexecute).

| Area | Tools |
|------|-------|
| User | `get_current_user`, `update_current_user` |
| Accounts | `list_accounts`, `get_account`, `create_account`, `update_account`, `delete_account` |
| Tags | `list_tags`, `create_tag`, `rename_tag`, `delete_tag`, `set_object_tags` |
| Plans | `list_plans`, `get_plan`, `get_plan_recurrence`, `create_plan`, `update_plan`, `activate_plan`, `change_plan_recurrence`, `complete_plan`, `cancel_plan`, `delete_plan` |
| Budgets | `list_budgets`, `get_budget`, `create_budget`, `update_budget`, `delete_budget` |
| Transactions | `list_transactions`, `get_transaction`, `log_transaction`, `add_planned_transaction`, `update_transaction`, `execute_planned_transaction`, `unexecute_transaction`, `delete_transaction` |
| Bank tickets (read-only) | `list_bank_tickets`, `get_bank_ticket` |

`delete_*`, `complete_plan` and `cancel_plan` carry the MCP `destructiveHint`, so clients ask for confirmation.

**Environment**

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | HTTP port |
| `BACKEND_URL` | `http://localhost:3000` | Backend base URL |
| `KEYCLOAK_ISSUER` | `http://localhost:8080/realms/ugo` | Must equal the `iss` of issued tokens (the URL clients use for Keycloak) |
| `KEYCLOAK_JWKS_URI` | `<issuer>/protocol/openid-connect/certs` | Internal key URL when the issuer is public |
| `MCP_PUBLIC_URL` | `http://localhost:<PORT>` | Public URL of this server, published in the OAuth metadata |
| `MCP_AUDIENCE` | unset | Require this `aud` claim (the `ugo-mcp` client adds `ugo-mcp`; clients registered dynamically do not) |
| `MCP_ALLOWED_ORIGINS` | empty | Comma-separated browser origins allowed to call `/mcp` |
| `MCP_SCOPES` | `openid profile email` | Scopes clients are told to request (published in the metadata and the 401 challenge) |

**Remote (Streamable HTTP)**: `npm run mcp:dev` or `docker compose up -d mcp`, endpoint `http://localhost:3001/mcp`. Clients discover Keycloak from `/.well-known/oauth-protected-resource` and log in through it. The server is stateless, so it can run as several replicas.
Keycloak setup:
- The realm has a pre-registered public client `ugo-mcp` (PKCE, loopback redirect URIs).
- For clients that register themselves, enable anonymous dynamic client registration in the Keycloak admin console (Clients, Client registration) and add the client's redirect hosts to the *Trusted Hosts* policy.

**Local (stdio)**: stdio cannot run the login flow, so supply a token:

```json
{
  "servers": {
    "ugo": {
      "command": "node",
      "args": ["packages/mcp/dist/stdio.js"],
      "env": {
        "BACKEND_URL": "http://localhost:3000",
        "KEYCLOAK_ISSUER": "http://localhost:8080/realms/ugo",
        "UGO_REFRESH_TOKEN": "<offline refresh token>"
      }
    }
  }
}
```

Get a refresh token with the device flow of the `ugo-mcp` client (`UGO_ACCESS_TOKEN` also works but expires after 5 minutes). The client requires PKCE, so use the script instead of plain curl:

```
npm run mcp:login
```

It opens the Keycloak login in the browser and prints `UGO_REFRESH_TOKEN=...` once you have logged in.

**Production**: remote clients need HTTPS and a public hostname. Put `mcp`, `backend` and Keycloak behind a reverse proxy, run Keycloak with a fixed `KC_HOSTNAME` instead of the dev settings in `docker-compose.yml`, and set `KEYCLOAK_ISSUER` and `MCP_PUBLIC_URL` (compose reads both from the environment or a `.env` file) to the public URLs.

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

# DB access
# GUI browser (opens in browser at localhost:5555)
npm run db:studio -w packages/backend

Or connect with any Postgres client (DBeaver, TablePlus, psql):
host: localhost  port: 5432  db: ugo  user: ugo  pass: ugo_dev

# Service	URL	Notes
| Frontend | http://localhost:5173 | Vite dev server |
| Backend | http://localhost:3000 | Express (native, not Docker) | 
| Node debugger | localhost:9229 | VS Code attaches here | 
| PostgreSQL | localhost:5432 | Docker | 
| Keycloak | http://localhost:8080 | Docker | 

## Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **1** | Monorepo + PostgreSQL + Prisma schema + Docker Compose | ✅ Done |
| **2** | REST CRUD routes + Keycloak JWT auth middleware | Planned |
| **3** | Repoint frontend from Resco OData to own backend | Planned |
| **4** | CSV import + transaction matching (server-side or hybrid) | Planned |
| **5** | Multi-user support, business units, permissions | Planned |
