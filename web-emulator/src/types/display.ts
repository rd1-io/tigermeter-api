// v5 display types — bitmap frames, no text instructions

export type LedColor = 'green' | 'red' | 'blue' | 'yellow' | 'cyan' | 'magenta' | 'white' | 'rainbow' | 'off';
export type LedBrightness = 'low' | 'mid' | 'high' | 'off';

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
  createdAt?: string;
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