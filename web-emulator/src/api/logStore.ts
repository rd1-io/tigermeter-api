export interface RequestLogEntry {
  id: string;
  ts: number;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: any;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: any;
  error?: string;
  durationMs?: number;
}

type Listener = (entries: RequestLogEntry[]) => void;

class LogStore {
  private entries: RequestLogEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private maxEntries: number;

  constructor(limit = 200) {
    this.maxEntries = limit;
  }

  add(entry: RequestLogEntry) {
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) this.entries.length = this.maxEntries;
    this.emit();
  }

  update(id: string, patch: Partial<RequestLogEntry>) {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx >= 0) {
      this.entries[idx] = { ...this.entries[idx], ...patch };
      this.emit();
    }
  }

  all() {
    return this.entries;
  }

  clear() {
    this.entries = [];
    this.emit();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.entries);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l(this.entries);
  }
}

export const requestLogStore = new LogStore(Number(import.meta.env.VITE_REQUEST_LOG_LIMIT || 200));

export interface FetchOptions extends RequestInit {
  bodyJson?: any;
}

export async function loggedFetch(method: string, url: string, opts: FetchOptions = {}): Promise<Response> {
  const id = crypto.randomUUID();
  const started = performance.now();
  const headers: Record<string, string> = {};
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers as any)) headers[k] = String(v);
  }
  let requestBody: any;
  const init: RequestInit = { ...opts, method };
  if (opts.bodyJson !== undefined) {
    requestBody = opts.bodyJson;
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    init.body = JSON.stringify(opts.bodyJson);
  } else if (typeof opts.body === 'string') {
    requestBody = opts.body;
  }
  init.headers = headers;

  requestLogStore.add({ id, ts: Date.now(), method, url, requestHeaders: headers, requestBody });
  try {
    const res = await fetch(url, init);
    const durationMs = performance.now() - started;
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (responseHeaders[k] = v));
    let responseBody: any;
    const clone = res.clone();
    const ct = res.headers.get('content-type') || '';
    try {
      if (ct.includes('application/json')) {
        responseBody = await clone.json();
      } else {
        const text = await clone.text();
        responseBody = text.length > 2000 ? text.slice(0, 2000) + '…(truncated)' : text;
      }
    } catch (e: any) {
      responseBody = `(body read error: ${e.message || e})`;
    }
    requestLogStore.update(id, { responseStatus: res.status, responseHeaders, responseBody, durationMs });
    return res;
  } catch (e: any) {
    const durationMs = performance.now() - started;
    requestLogStore.update(id, { error: e.message || String(e), durationMs });
    throw e;
  }
}
