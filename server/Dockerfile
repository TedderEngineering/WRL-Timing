FROM node:20-slim

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci --include=dev

RUN npx prisma generate

COPY . .

RUN npx tsc || true

RUN npm prune --production

EXPOSE 3000

CMD ["node", "dist/index.js"]
