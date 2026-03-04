# RaceTrace by Tedder Engineering

Interactive race analysis and lap chart visualization for World Racing League.

## Tech Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT (self-rolled)
- **Payments**: Stripe
- **File Storage**: AWS S3

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (for local Postgres/Redis)

### Setup

1. Clone the repo and install dependencies:
```bash
# Server
cd server && npm install

# Client
cd ../client && npm install
```

2. Start local databases:
```bash
docker compose up -d
```

3. Copy environment config:
```bash
cp .env.example server/.env
```

4. Run database migrations and seed:
```bash
cd server
npx prisma migrate dev
npm run db:seed
```

5. Start the development servers:
```bash
# Terminal 1 — Backend
cd server && npm run dev

# Terminal 2 — Frontend
cd client && npm run dev
```

The frontend runs at `http://localhost:5173` and proxies API requests to `http://localhost:3000`.

### Default Accounts (after seeding)

| Email | Password | Role |
|-------|----------|------|
| admin@tedderengineering.com | admin123456 | Admin |
| user@example.com | user123456 | User |

## Project Structure

```
wrl-lap-chart/
├── client/          # React frontend (Vite)
├── server/          # Express backend
│   └── prisma/      # Database schema & migrations
├── shared/          # Shared TypeScript types
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Scripts

### Server
| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:seed` | Seed the database |
| `npm run db:studio` | Open Prisma Studio |
| `npm test` | Run tests |

### Client
| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm test` | Run tests |

## Local Development (Quick Start)

### Prerequisites
- Docker Desktop (for local Postgres)
- Node.js 20+
- npm

### First-Time Setup
1. Copy `.env.example` to `.env.local` and fill in your dev values
2. `cd server && npm run dev:setup`
3. Open a second terminal: `cd server && npm run dev`
4. Open a third terminal: `cd client && npm run dev`
5. Frontend: http://localhost:5173, Backend: http://localhost:3001

### Resetting Local Database
```bash
cd server && npm run dev:db:reset
```

### Stripe Testing
Use Stripe test mode keys (`sk_test_` / `pk_test_`) in `.env.local`.
Test cards: `4242424242424242` (success), `4000000000000002` (decline)

### Environment Overview

| Concern   | Production          | Local Dev                    |
|-----------|---------------------|------------------------------|
| Frontend  | Vercel              | localhost:5173               |
| Backend   | Railway             | localhost:3001               |
| Database  | Supabase Postgres   | Docker Postgres (port 5433)  |
| Stripe    | Live keys           | Test keys (sk_test_/pk_test_)|
