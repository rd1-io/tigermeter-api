/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_FIRMWARE_VERSION?: string;
  readonly VITE_REQUEST_LOG_LIMIT?: string;
  readonly VITE_JWT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
