## Web emulator Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app/web-emulator

COPY package*.json tsconfig.json vite.config.ts ./
COPY postcss.config.js tailwind.config.js ./
# Work around intermittent npm 10 bug and transient DNS failures on CI
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-maxtimeout 60000 \
  && npm config set fetch-retry-mintimeout 20000 \
  && for i in 1 2 3 4 5; do \
       npm i -g npm@9 && break || { echo "npm@9 install failed, retry $i"; sleep $((i*5)); }; \
     done
# Improve npm reliability in CI containers
RUN npm config set fund=false \
  && npm config set audit=false \
  && npm config set update-notifier=false \
  && npm install --no-audit --no-fund --progress=false

COPY . ./
ARG VITE_API_BASE_URL
ARG VITE_HMAC_KEY
ARG VITE_JWT_SECRET
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_HMAC_KEY=${VITE_HMAC_KEY}
ENV VITE_JWT_SECRET=${VITE_JWT_SECRET}
RUN npm run build

FROM caddy:2-alpine AS runner
WORKDIR /srv
COPY --from=builder /app/web-emulator/dist /srv
EXPOSE 80
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]






