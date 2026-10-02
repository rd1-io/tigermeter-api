// v5 display types — bitmap frames, no text instructions

export type LedColor = 'green' | 'red' | 'blue' | 'yellow' | 'cyan' | 'magenta' | 'white' | 'rainbow' | 'off';
export type LedBrightness = 'low' | 'mid' | 'high' | 'off';

export const LED_COLORS: LedColor[] = ['green', 'red', 'blue', 'yellow', 'cyan', 'magenta', 'white', 'rainbow', 'off'];
export const LED_BRIGHTNESSES: LedBrightness[] = ['low', 'mid', 'high', 'off'];

export const LED_COLOR_LABELS: Record<LedColor, string> = {
  green: 'Зелёный',
  red: 'Красный',
  blue: 'Синий',
  yellow: 'Жёлтый',
  cyan: 'Голубой',
  magenta: 'Пурпурный',
  white: 'Белый',
  rainbow: 'Радуга',
  off: 'Выкл',
};

export const LED_BRIGHTNESS_LABELS: Record<LedBrightness, string> = {
  low: 'Низкая',
  mid: 'Средняя',
  high: 'Высокая',
  off: 'Выкл',
};

export interface DisplayFrame {
  bitmap: string;          // base64, 8064 bytes decoded (384x168 1-bit packed)
  ledColor: LedColor;
  ledBrightness: LedBrightness;
  durationSec: number;
  beep?: boolean;
  flashCount?: number;
  // Firmware v39+: auto = partial when replacing a frame with periodic full refreshes; ignored by older firmware
  refreshMode?: RefreshMode;
}

export type RefreshMode = 'auto' | 'full' | 'partial';

export interface DisplayFramesPayload {
  frames: DisplayFrame[];
  refreshInterval: number;
}

// Device as returned by API
export interface DeviceDto {
  id: string;
  mac: string;
  name: string | null;
  tenantId: string | null;
  externalUserId: string | null;
  status: string;
  lastSeen: string | null;
  battery: number | null;
  rssi: number | null;
  firmwareVersion: string | null;
  autoUpdate: boolean;
  demoMode: boolean;
  displayHash: string | null;
  displayVersion: number;
  reportedDisplayHash?: string | null;
  ip?: string | null;
  createdAt?: string;
}

// GET /devices/:id (manage) and /admin/devices/:id (ops)
export interface DeviceStateDto extends DeviceDto {
  ip: string | null;
  uptimeSeconds: number | null;
  displayUpdatedAt: string | null;
  deliveredDisplayHash: string | null;
  displayDeliveredAt: string | null;
  reportedDisplayHash: string | null;
  displayRebootCount: number;
  displayBlocked: boolean;
  // Firmware v38+: resetReason, prevStage, psram, psramSize, freePsram, freeHeap, minFreeHeap,
  // maxAllocHeap, stackFree, frameBuffers, lastResponseBytes, lastError;
  // v39+: lastRefresh (full/partial/skip), lastRefreshMs, partialSinceFull, fullRefreshes, partialRefreshes, skippedRefreshes
  diagnostics: Record<string, string | number | boolean> | null;
  framesSupported: boolean;
  minFramesFirmwareVersion: number;
  // Server-side rotation: the device holds one frame; null when there are no frames
  rotation: {
    currentIndex: number;
    cycleSec: number | null;
    nextSwitchInSec: number | null;
    effectiveDurations: number[];
    minFrameSec: number;
  } | null;
  deliveredFrameIndex: number | null;
  deviceFrameIndex: number | null;
  // Admin live test session: short heartbeat interval until `until`
  live: { active: boolean; until: string | null; intervalSec: number | null };
  // Interval sent with the last delivery — the one the device runs on
  deliveredRefreshInterval: number | null;
  frameCount: number;
  refreshInterval: number | null;
  pendingFactoryReset: boolean;
  latestFirmwareVersion: number;
}

export interface PendingDeviceDto {
  id: string;
  mac: string;
  firmwareVersion: string | null;
  ip: string | null;
  firstSeen: string;
  lastSeen: string;
  attemptCount: number;
  status: string;
}

export interface MeResponse {
  tenantId: string;
  scope: 'ops' | 'manage';
}

// Default frame for new editor
export const DEFAULT_FRAME: DisplayFrame = {
  bitmap: '',
  ledColor: 'green',
  ledBrightness: 'mid',
  durationSec: 30,
  beep: false,
  flashCount: 0,
};