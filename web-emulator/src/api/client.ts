// v5 API client — service-token auth, no user JWTs

export interface ApiClientOptions {
  baseUrl?: string;
}

const V5_PREFIX = '/api/v5';

// Reserved tenant the server parks outdated unclaimed devices on while they OTA-update
export const STAGING_TENANT_ID = 'staging';

export type Scope = 'ops' | 'manage';

export interface TenantDto {
  tenantId: string;
  scopes: Scope[];
}

export interface AdminSettings {
  autoProvisionNewDevices: boolean;
  autoUpgradeOutdatedDevices: boolean;
  latestFirmwareVersion: number;
}

import { loggedFetch } from './logStore';

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  // ops acts across tenants through /admin endpoints; manage stays on its own tenant's endpoints
  private scope: Scope | null = null;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
  }

  // Auth
  setToken(token: string) {
    this.token = token;
    localStorage.setItem('serviceToken', token);
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('serviceToken');
    }
    return this.token;
  }

  clearToken() {
    this.token = null;
    this.scope = null;
    localStorage.removeItem('serviceToken');
  }

  setScope(scope: Scope | null) {
    this.scope = scope;
  }

  private get isOps(): boolean {
    return this.scope === 'ops';
  }

  private authHeaders(): Record<string, string> {
    const t = this.getToken();
    if (!t) return {};
    return { 'Authorization': `Bearer ${t}` };
  }

  // Auth check
  async me(): Promise<Response> {
    return loggedFetch('GET', `${this.baseUrl}${V5_PREFIX}/admin/me`, {
      headers: this.authHeaders(),
    });
  }

  // === Devices (ops — all, manage — tenant-scoped) ===
  private devicesPath(): string {
    return `${this.baseUrl}${V5_PREFIX}${this.isOps ? '/admin' : ''}/devices`;
  }

  async listDevices(quiet = false): Promise<Response> {
    return loggedFetch('GET', this.devicesPath(), {
      headers: this.authHeaders(),
      quiet,
    });
  }

  // Telemetry + display delivery state
  async getDevice(id: string, quiet = false): Promise<Response> {
    return loggedFetch('GET', `${this.devicesPath()}/${id}`, {
      headers: this.authHeaders(),
      quiet,
    });
  }

  async getDeviceDisplay(id: string): Promise<Response> {
    return loggedFetch('GET', `${this.devicesPath()}/${id}/display`, {
      headers: this.authHeaders(),
    });
  }

  async setDisplayFrames(id: string, payload: any): Promise<Response> {
    return loggedFetch('PUT', `${this.devicesPath()}/${id}/display`, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      bodyJson: payload,
    });
  }

  async patchDevice(id: string, data: { name?: string; autoUpdate?: boolean; demoMode?: boolean }): Promise<Response> {
    const url = this.isOps
      ? `${this.baseUrl}${V5_PREFIX}/admin/devices/${id}/settings`
      : `${this.baseUrl}${V5_PREFIX}/devices/${id}`;
    return loggedFetch('PATCH', url, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      bodyJson: data,
    });
  }

  async revokeDevice(id: string): Promise<Response> {
    return loggedFetch('POST', `${this.devicesPath()}/${id}/revoke`, {
      headers: this.authHeaders(),
    });
  }

  async deleteDevice(id: string): Promise<Response> {
    return loggedFetch('DELETE', `${this.baseUrl}${V5_PREFIX}/admin/devices/${id}`, {
      headers: this.authHeaders(),
    });
  }

  async factoryReset(id: string): Promise<Response> {
    return loggedFetch('POST', `${this.baseUrl}${V5_PREFIX}/admin/devices/${id}/factory-reset`, {
      headers: this.authHeaders(),
    });
  }

  async updateDeviceSettings(id: string, settings: { autoUpdate?: boolean; demoMode?: boolean }): Promise<Response> {
    return this.patchDevice(id, settings);
  }

  // === Pending devices (ops only) ===
  async listPendingDevices(): Promise<Response> {
    return loggedFetch('GET', `${this.baseUrl}${V5_PREFIX}/admin/pending-devices`, {
      headers: this.authHeaders(),
    });
  }

  async approvePending(id: string, tenantId: string): Promise<Response> {
    return loggedFetch('POST', `${this.baseUrl}${V5_PREFIX}/admin/pending-devices/${id}/approve`, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      bodyJson: { tenantId },
    });
  }

  async rejectPending(id: string): Promise<Response> {
    return loggedFetch('POST', `${this.baseUrl}${V5_PREFIX}/admin/pending-devices/${id}/reject`, {
      headers: this.authHeaders(),
    });
  }

  // === Settings (ops only) ===
  async getAdminSettings(): Promise<Response> {
    return loggedFetch('GET', `${this.baseUrl}${V5_PREFIX}/admin/settings`, {
      headers: this.authHeaders(),
    });
  }

  async patchAdminSettings(settings: Partial<Pick<AdminSettings, 'autoProvisionNewDevices' | 'autoUpgradeOutdatedDevices'>>): Promise<Response> {
    return loggedFetch('PATCH', `${this.baseUrl}${V5_PREFIX}/admin/settings`, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      bodyJson: settings,
    });
  }

  // Tenants an ops admin can attach devices to (from SERVICE_TOKENS, without staging)
  async listTenants(): Promise<Response> {
    return loggedFetch('GET', `${this.baseUrl}${V5_PREFIX}/admin/tenants`, {
      headers: this.authHeaders(),
    });
  }

  // Attach claim code: manage attaches to its own tenant, ops to the chosen one
  async attachClaim(code: string, params: { tenantId?: string; externalUserId?: string }): Promise<Response> {
    const url = this.isOps
      ? `${this.baseUrl}${V5_PREFIX}/admin/device-claims/${encodeURIComponent(code)}/attach`
      : `${this.baseUrl}${V5_PREFIX}/device-claims/${encodeURIComponent(code)}/attach`;
    const bodyJson = this.isOps
      ? { tenantId: params.tenantId, ...(params.externalUserId ? { externalUserId: params.externalUserId } : {}) }
      : { externalUserId: params.externalUserId };
    return loggedFetch('POST', url, {
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      bodyJson,
    });
  }

  // === Hash utilities ===
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

  async computeDisplayHash(payload: any): Promise<string> {
    const copy = { ...payload };
    delete copy.hash;
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