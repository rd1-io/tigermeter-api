// Font size is now numeric (10-40 pixels)
// Preset values: 10, 12, 16, 20, 24, 28, 32, 40
export type FontSize = number;

export const FONT_SIZE_PRESETS: number[] = [10, 12, 16, 20, 24, 28, 32, 40];

export type TextAlign = 'left' | 'center' | 'right';
export type LedColor = 'blue' | 'green' | 'red' | 'yellow' | 'purple';
export type LedBrightness = 'off' | 'low' | 'mid' | 'high';

// Display instruction
export interface DisplayInstruction {
  // Metadata
  version: number;
  hash: string;
  
  // Required fields
  symbol: string;
  mainText: string;
  
  // Symbol (left bar)
  symbolFontSize?: FontSize;
  
  // Top line
  topLine?: string;
  topLineFontSize?: FontSize;
  topLineAlign?: TextAlign;
  topLineShowDate?: boolean;
  
  // Main text
  mainTextFontSize?: FontSize;
  mainTextAlign?: TextAlign;
  
  // Bottom line
  bottomLine?: string;
  bottomLineFontSize?: FontSize;
  bottomLineAlign?: TextAlign;
  
  // LED control
  ledColor?: LedColor;
  ledBrightness?: LedBrightness;
  
  // One-time actions
  beep?: boolean;
  flashCount?: number;
  
  // Device behavior
  refreshInterval?: number;
  timezoneOffset?: number; // Hours from UTC (e.g., 3 for Moscow, -5 for New York)
  
  // Future extensions
  extensions?: Record<string, unknown>;
}

export interface HeartbeatData {
  battery?: number;
  rssi?: number;
  ip?: string;
  firmwareVersion: string;
  uptimeSeconds: number;
  displayHash: string;
}

export interface HeartbeatResponse {
  ok?: boolean;
  instruction?: DisplayInstruction;
  displayHash?: string;
}

// Default values for form
export const DISPLAY_DEFAULTS: Partial<DisplayInstruction> = {
  symbolFontSize: 24,
  topLine: '',
  topLineFontSize: 16,
  topLineAlign: 'center',
  topLineShowDate: false,
  mainTextFontSize: 32,
  mainTextAlign: 'center',
  bottomLine: '',
  bottomLineFontSize: 16,
  bottomLineAlign: 'center',
  ledColor: 'green',
  ledBrightness: 'mid',
  beep: false,
  flashCount: 0,
  refreshInterval: 30,
  timezoneOffset: 3, // Default to Moscow (UTC+3)
};
