# WRL Lap Chart — Architecture & Tech Stack Decisions

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | React (Vite) + TypeScript | Fast dev server, excellent TS support, broad ecosystem |
| UI Framework | Tailwind CSS + shadcn/ui | Utility-first, great DX, accessible components |
| Backend | Node.js + Express + TypeScript | Shared language with frontend, strong ecosystem |
| Database | PostgreSQL | Best relational DB for complex queries on lap data |
| ORM | Prisma | Type-safe queries, excellent migrations, great DX |
| Auth | Self-rolled (JWT + bcrypt) | Full control, no vendor lock-in, good for learning |
| Payments | Stripe | Industry standard, excellent docs and webhooks |
| File Storage | AWS S3 | Cheapest for CSV storage, well-supported |
| Hosting (Frontend) | Vercel | Zero-config React deploys, great preview deploys |
| Hosting (Backend) | Railway | Simple Docker deploys, built-in Postgres option |
| Hosting (DB) | Railway Postgres (or Neon) | Co-located with backend, easy provisioning |
| Email | Resend | Modern API, great DX, generous free tier |
| Monitoring | Sentry | Best-in-class error tracking for both FE and BE |

## Key Decisions

### Why self-rolled auth instead of Clerk/Supabase Auth?
- No external dependency for core functionality
- Full control over user data and session management
- Stripe integration is simpler when we own the user table
- Cost savings at scale (Clerk charges per MAU)

### Why Prisma over Drizzle?
- More mature migration system
- Better documentation
- Type-safe client generation is excellent for this schema
- Drizzle is faster at runtime but we're not at that scale

### Why Express over Fastify/Hono?
- Most middleware and examples available
- Team familiarity (broadest Node.js framework knowledge)
- Performance difference negligible at our scale

## Environment Configuration

### Required Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/wrl_lap_chart

# Auth
JWT_ACCESS_SECRET=<random-64-char-hex>
JWT_REFRESH_SECRET=<random-64-char-hex>
BCRYPT_ROUNDS=12

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_TEAM_MONTHLY=price_...
STRIPE_PRICE_TEAM_ANNUAL=price_...

# AWS S3
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=wrl-lap-chart-uploads

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@wrllapchart.com

# URLs
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000

# Monitoring
SENTRY_DSN=https://...@sentry.io/...

# General
NODE_ENV=development
PORT=3000
```
