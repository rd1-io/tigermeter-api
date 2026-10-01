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