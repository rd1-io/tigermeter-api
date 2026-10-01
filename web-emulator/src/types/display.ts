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
}

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
  // maxAllocHeap, stackFree, frameBuffers, lastResponseBytes, lastError
  diagnostics: Record<string, string | number | boolean> | null;
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