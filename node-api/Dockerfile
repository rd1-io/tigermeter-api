## Node API Dockerfile
## Multi-stage build: build TypeScript, generate Prisma client, prune dev deps

FROM node:20-alpine AS builder
WORKDIR /app/node-api

# Install dependencies
COPY package*.json tsconfig.json prisma ./
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-maxtimeout 60000 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fund=false \
  && npm config set audit=false \
  && npm config set update-notifier=false \
  && npm install --no-audit --no-fund --progress=false

# Copy source and build
# Generate Prisma client before TypeScript build to satisfy type imports
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and build
COPY . ./
RUN npm run build \
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






