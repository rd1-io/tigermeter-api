export interface ApiClientOptions {
  baseUrl?: string;
  firmwareVersion?: string;
}

import { loggedFetch } from './logStore';

export class ApiClient {
  private baseUrl: string;
  private firmwareVersion: string;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api').replace(/\/$/, '');
    this.firmwareVersion = opts.firmwareVersion || import.meta.env.VITE_FIRMWARE_VERSION || '1.0.0';
  }

  async issueClaim(mac: string): Promise<Response> {
    const timestamp = Date.now();
    const hmac = await this.createClaimHmac(mac, this.firmwareVersion, timestamp);
    const body = { 
      mac, 
      firmwareVersion: this.firmwareVersion, 
      timestamp,
      hmac
    };
    return loggedFetch('POST', `${this.baseUrl}/device-claims`, { bodyJson: body });
  }

  private async createClaimHmac(mac: string, firmwareVersion?: string, timestamp?: number): Promise<string> {
    const ts = timestamp || Date.now();
    const payload = `${mac}:${firmwareVersion || ''}:${ts}`;
    const hmacKey = import.meta.env.VITE_HMAC_KEY || 'change-me-dev-hmac';
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(hmacKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async provisionDevice(mac: string, firmwareVersion?: string): Promise<Response> {
    const body = { mac, firmwareVersion: firmwareVersion || this.firmwareVersion };
    return loggedFetch('POST', `${this.baseUrl}/devices/provision`, { bodyJson: body });
  }

  async pollClaimCode(code: string): Promise<Response> {
    return loggedFetch('GET', `${this.baseUrl}/device-claims/${code}/poll`, {});
  }

  async sendHeartbeat(deviceId: string, deviceSecret: string, heartbeatData: any): Promise<Response> {
    return loggedFetch('POST', `${this.baseUrl}/devices/${deviceId}/heartbeat`, {
      headers: {
        'Authorization': `Bearer ${deviceSecret}`,
      },
      bodyJson: heartbeatData
    });
  }

  async attachClaim(code: string, userToken: string): Promise<Response> {
    return loggedFetch('POST', `${this.baseUrl}/device-claims/${code}/attach`, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      }
    });
  }
}

export const apiClient = new ApiClient();
