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

  // Admin methods
  async listDevicesAdmin(adminToken: string): Promise<Response> {
    return loggedFetch('GET', `${this.baseUrl}/admin/devices`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      }
    });
  }

  async getDeviceAdmin(id: string, adminToken: string): Promise<Response> {
    return loggedFetch('GET', `${this.baseUrl}/devices/${id}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      }
    });
  }

  async revokeDeviceAdmin(id: string, adminToken: string): Promise<Response> {
    return loggedFetch('POST', `${this.baseUrl}/admin/devices/${id}/revoke`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      }
    });
  }

  async deleteDeviceAdmin(id: string, adminToken: string): Promise<Response> {
    return loggedFetch('DELETE', `${this.baseUrl}/admin/devices/${id}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      }
    });
  }

  async factoryResetAdmin(id: string, adminToken: string): Promise<Response> {
    return loggedFetch('POST', `${this.baseUrl}/admin/devices/${id}/factory-reset`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      }
    });
  }

  async updateDeviceSettings(id: string, adminToken: string, settings: { autoUpdate?: boolean; demoMode?: boolean }): Promise<Response> {
    return loggedFetch('PATCH', `${this.baseUrl}/admin/devices/${id}/settings`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      },
      bodyJson: settings
    });
  }

  async listPendingDevicesAdmin(adminToken: string): Promise<Response> {
    return loggedFetch('GET', `${this.baseUrl}/admin/pending-devices`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      }
    });
  }

  async approvePendingDevice(id: string, adminToken: string): Promise<Response> {
    return loggedFetch('POST', `${this.baseUrl}/admin/pending-devices/${id}/approve`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      }
    });
  }

  async rejectPendingDevice(id: string, adminToken: string): Promise<Response> {
    return loggedFetch('POST', `${this.baseUrl}/admin/pending-devices/${id}/reject`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      }
    });
  }

  async setDisplay(id: string, userToken: string, instruction: any): Promise<Response> {
    return loggedFetch('PUT', `${this.baseUrl}/devices/${id}/display`, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
      },
      bodyJson: instruction
    });
  }

  // Recursively sort all keys in an object for deterministic JSON
  private sortObjectKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return (obj as unknown[]).map(item => this.sortObjectKeys(item));
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = this.sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  // Helper to compute display instruction hash (without hash field)
  // Must match backend's instructionHash: sorts ALL keys recursively
  async computeDisplayHash(instruction: any): Promise<string> {
    const copy = { ...instruction };
    delete copy.hash;
    
    // Sort ALL keys recursively for deterministic hashing
    const sorted = this.sortObjectKeys(copy);
    const json = JSON.stringify(sorted);
    
    const encoder = new TextEncoder();
    const data = encoder.encode(json);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `sha256:${hashHex}`;
  }
}

export const apiClient = new ApiClient();
