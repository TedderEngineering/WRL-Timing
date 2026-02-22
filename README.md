# WRL Lap Chart

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
| admin@wrllapchart.com | admin123456 | Admin |
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
