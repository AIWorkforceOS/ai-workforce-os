# AI Workforce OS

The operating system for AI-powered workforces.

## Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Monorepo   | Turborepo + pnpm workspaces         |
| Web app    | Next.js 14 (App Router) + TypeScript |
| Styling    | CSS Variables (Tailwind ready)      |
| Lint       | ESLint 9 (Flat Config)              |
| Format     | Prettier 3                          |
| Deploy     | Vercel                              |
| Database   | Supabase (pending first migration)  |

## Monorepo Structure

```
ai-workforce-os/
├── apps/
│   └── web/          # Next.js web application
├── packages/
│   ├── ui/           # Shared UI components
│   ├── utils/        # Shared utilities
│   └── types/        # Shared TypeScript types
├── packs/            # Workforce Packs (e.g., packs/smarter/)
├── infra/            # Infrastructure as code
├── tools/            # Dev tooling
└── docs/             # Architecture & decision records
```

## Local Setup

### Prerequisites

- Node.js 20+
- pnpm 11+ — install via `curl -fsSL https://get.pnpm.io/install.sh | sh -`

### Steps

```bash
# 1. Clone
git clone https://github.com/AIWorkforceOS/ai-workforce-os.git
cd ai-workforce-os

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env.local
# Fill in the values in .env.local (never commit this file)

# 4. Run the web app in dev mode
pnpm dev
# → http://localhost:3000
```

### Available Commands

| Command             | Description                          |
|---------------------|--------------------------------------|
| `pnpm dev`          | Start all apps in development mode   |
| `pnpm build`        | Build all apps and packages          |
| `pnpm lint`         | Lint all workspaces                  |
| `pnpm typecheck`    | TypeScript type-check all workspaces |
| `pnpm format`       | Format all files with Prettier       |
| `pnpm format:check` | Check formatting without writing     |

### Run only the web app

```bash
pnpm --filter @ai-workforce-os/web dev
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values. See `.env.example` for all required variables. **Never commit `.env.local`.**

## Architecture

See [`docs/architecture-freeze-v1.md`](./docs/architecture-freeze-v1.md) for the approved Architecture Freeze v1.0.

Key rule: **Smarter is a Workforce Pack, not part of the Core.** Smarter code lives in `packs/smarter/` and accesses the Core via public interfaces only.

## Security

- No secrets in the repository
- `.env*` files are gitignored (except `.env.example`)
- Service keys are server-side only — never use `NEXT_PUBLIC_` prefix for secrets
