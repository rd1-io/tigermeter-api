export interface DisplaySingle {
  name: string;
  price: number;
  currencySymbol: string;
  timestamp: string;
  ledColor?: 'blue' | 'green' | 'red' | 'yellow' | 'purple';
  beep?: boolean;
  flashCount?: number;
  ledBrightness?: 'off' | 'low' | 'mid' | 'high';
  portfolioValue?: number;
  portfolioChangeAbsolute?: number;
  portfolioChangePercent?: number;
  extensions?: Record<string, any>;
}

export interface DisplayPlaylist {
  items: DisplaySingle[];
  displaySeconds: number;
  extensions?: Record<string, any>;
}

export interface DisplayInstructionBase {
  type: 'single' | 'playlist';
  version: number;
  hash: string;
  extensions?: Record<string, any>;
}

export interface DisplayInstructionSingle extends DisplayInstructionBase {
  type: 'single';
  single: DisplaySingle;
}

export interface DisplayInstructionPlaylist extends DisplayInstructionBase {
  type: 'playlist';
  playlist: DisplayPlaylist;
}

export type DisplayInstruction = DisplayInstructionSingle | DisplayInstructionPlaylist;

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