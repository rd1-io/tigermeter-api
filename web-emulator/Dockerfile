## Web emulator Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app/web-emulator

COPY package*.json tsconfig.json vite.config.ts ./
COPY postcss.config.js tailwind.config.js ./
RUN npm ci

COPY . ./
ARG VITE_API_BASE_URL
ARG VITE_HMAC_KEY
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_HMAC_KEY=${VITE_HMAC_KEY}
RUN npm run build

FROM caddy:2-alpine AS runner
WORKDIR /srv
COPY --from=builder /app/web-emulator/dist /srv
EXPOSE 80
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]






