## Node API Dockerfile
## Multi-stage build: build TypeScript, generate Prisma client, prune dev deps

FROM node:20-alpine AS builder
WORKDIR /app/node-api

# Install dependencies
COPY package*.json tsconfig.json prisma ./
RUN npm ci

# Copy source and build
COPY . ./
RUN npm run build \
  && npx prisma generate \
  && npm prune --omit=dev


FROM node:20-alpine AS runner
WORKDIR /app/node-api
ENV NODE_ENV=production

# Copy built app, prisma client, and production node_modules
COPY --from=builder /app/node-api/package*.json ./
COPY --from=builder /app/node-api/node_modules ./node_modules
COPY --from=builder /app/node-api/dist ./dist
COPY --from=builder /app/node-api/generated ./generated
COPY --from=builder /app/node-api/prisma ./prisma

EXPOSE 3001

# Ensure schema is applied for SQLite and start server
CMD ["sh", "-c", "npx prisma db push && node dist/server.js"]






