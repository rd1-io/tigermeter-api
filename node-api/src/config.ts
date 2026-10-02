export const config = {
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-dev',
  hmacKey: process.env.HMAC_KEY ?? 'change-me-dev-hmac',
  deviceSecretPrefix: 'ds_',
  deviceSecretLength: 64, // not including prefix
  deviceSecretTtlDays: 90,
  deviceSecretOverlapSeconds: 300,
  claimCodeTtlSeconds: 300,
  claimHmacToleranceMs: 300_000,
  // Firmware <= v36 signs claims with device uptime (millis()) instead of unix ms, so its
  // timestamps can't be checked for freshness. Set to "false" once those devices are updated.
  allowLegacyClaimTimestamps: process.env.ALLOW_LEGACY_CLAIM_TIMESTAMPS !== 'false',
  // Attach is called by the integrator backend, so the limit is per service token, not per IP
  attachRateLimitPerMinute: parseInt(process.env.ATTACH_RATE_LIMIT_PER_MINUTE ?? '120', 10),
  // A whole batch of devices can sit behind one NAT IP (warehouse, office): an unprovisioned
  // device retries a claim every ~5s, so 100 devices need ~1200/min from a single IP.
  claimRateLimitPerIpPerMinute: parseInt(process.env.CLAIM_RATE_LIMIT_PER_IP_PER_MINUTE ?? '1500', 10),
  claimRateLimitPerMacPerMinute: parseInt(process.env.CLAIM_RATE_LIMIT_PER_MAC_PER_MINUTE ?? '30', 10),
  // Firmware polls every 3s (20/min); keyed per code, unknown codes are limited per IP instead
  pollRateLimitPerCodePerMinute: parseInt(process.env.POLL_RATE_LIMIT_PER_CODE_PER_MINUTE ?? '60', 10),
  pollUnknownCodesPerIpPerMinute: parseInt(process.env.POLL_UNKNOWN_CODES_PER_IP_PER_MINUTE ?? '30', 10),
  heartbeatRateLimitPerDevicePerMinute: parseInt(process.env.HEARTBEAT_RATE_LIMIT_PER_DEVICE_PER_MINUTE ?? '60', 10),

  // Server-side frame rotation (see utils/rotation.ts): frames shorter than the minimum are
  // stretched to it; heartbeats are timed to land `margin` seconds after a switch, and a heartbeat
  // up to `earlySwitch` seconds before a switch already gets the next frame
  rotationMinFrameSec: parseInt(process.env.ROTATION_MIN_FRAME_SEC ?? '10', 10),
  rotationMarginSec: parseInt(process.env.ROTATION_MARGIN_SEC ?? '1', 10),
  rotationEarlySwitchSec: parseInt(process.env.ROTATION_EARLY_SWITCH_SEC ?? '3', 10),
  // Admin live test sessions (POST /admin/devices/:id/live): short heartbeat interval, bounded in time
  liveMinIntervalSec: parseInt(process.env.LIVE_MIN_INTERVAL_SEC ?? '2', 10),
  liveMaxIntervalSec: 10,
  liveMaxDurationSec: parseInt(process.env.LIVE_MAX_DURATION_SEC ?? '900', 10),
  // Older firmware crashes on any frame on boards without PSRAM; such devices get no frames until OTA
  minFramesFirmwareVersion: parseInt(process.env.MIN_FRAMES_FIRMWARE_VERSION ?? '38', 10),

  // Reserved tenant for outdated unclaimed devices that are attached only to receive OTA
  stagingTenantId: 'staging',

  // Proxies whose X-Forwarded-For is trusted (proxy-addr syntax); the API runs behind Caddy
  trustProxy: process.env.TRUST_PROXY ?? 'loopback,linklocal,uniquelocal',

  // OTA firmware settings
  latestFirmwareVersion: parseInt(process.env.LATEST_FIRMWARE_VERSION ?? '3', 10),
  firmwareDownloadUrl: process.env.FIRMWARE_DOWNLOAD_URL ?? 'https://rd1-io.github.io/tigermeter-api/firmware/prod',

  // Service-to-service auth tokens (JSON array in env)
  serviceTokensJson: process.env.SERVICE_TOKENS ?? '',
};

// API version prefix — all routes use this
export const V5_PREFIX = '/api/v5';
// Firmware <= v36 was built against the unversioned prefix and calls only device endpoints there
export const LEGACY_DEVICE_PREFIX = '/api';