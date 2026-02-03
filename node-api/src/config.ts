export const config = {
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-dev',
  hmacKey: process.env.HMAC_KEY ?? 'change-me-dev-hmac',
  deviceSecretPrefix: 'ds_',
  deviceSecretLength: 64, // not including prefix
  deviceSecretTtlDays: 90,
  deviceSecretOverlapSeconds: 300,
  claimCodeTtlSeconds: 300,
  
  // OTA firmware settings
  latestFirmwareVersion: parseInt(process.env.LATEST_FIRMWARE_VERSION ?? '3', 10),
  firmwareDownloadUrl: process.env.FIRMWARE_DOWNLOAD_URL ?? 'https://rd1-io.github.io/tigermeter-api/firmware/prod',
};













