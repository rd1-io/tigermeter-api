# TigerMeter Web Emulator

Early-stage web emulator for the TigerMeter (Tickr) e-paper device. Focus: pixel-accurate 384x168 screen reproduction and simulation of claim → attach → poll → heartbeat → display update flows.

## Quick Start

```bash
cd web-emulator
npm install
cp .env.example .env # adjust API base if needed
npm run dev
```

Open: http://localhost:5175

## Current Features
- 384x168 screen container (initial placeholder content)
- MAC address input with automatic formatting (AA:BB:CC:DD:EE:FF)
- WiFi toggle initiating initial claim request (no HMAC yet)
- Basic project scaffold (Vite + React + TS + Tailwind)

## Planned (Incremental)
1. Poll endpoint integration & lazy secret capture
2. Persist state (MAC, claim code, secret) in localStorage
3. Heartbeat loop with display hash comparison
4. Display instruction rendering
5. Secret refresh & revoke handling (state transitions)
6. Network simulation (latency, jitter, offline, rate limit responses)
7. Visual debug overlay (FPS, timings, request log)
8. Pixel grid / sub-pixel accuracy mode & screenshot export

## Architecture Notes
- UI State will mirror firmware finite state machine to validate transitions.
- API client kept minimal; will expand with strongly typed helpers.
- Rendering pipeline will eventually build a virtual framebuffer for precise layout tests.

## Tailwind / Styling
Using Tailwind for rapid iteration; final pixel-perfect typography and spacing can layer custom classes or raw CSS modules if needed.

## Environment Variables
| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `VITE_API_BASE_URL` | Base URL of backend API (`/api` root) | `http://localhost:3001/api` |
| `VITE_FIRMWARE_VERSION` | Firmware version presented in claim | `1.0.0` |

## HMAC Placeholder
Real device claim uses HMAC for authenticity. Emulator will later implement a deterministic dev key or a user-supplied secret to compute the signature so backend can optionally validate.

## Contributing
Keep emulator changes isolated under `web-emulator/`. Coordinate API contract changes (see root `CONTRIBUTING.md`).
