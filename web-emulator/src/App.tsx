import React, { useState, useEffect } from "react";
import { apiClient } from "./api/client";
import { AdminPanel } from "./components/AdminPanel";
import { LogPanel } from "./components/LogPanel";
import { FrameEditor } from "./components/FrameEditor";
import { DeviceDto } from "./types/display";

type Tab = 'devices' | 'pending' | 'settings';

const App: React.FC = () => {
  const [token, setToken] = useState(apiClient.getToken() || "");
  const [scope, setScope] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string>("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectedDevice, setSelectedDevice] = useState<DeviceDto | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('devices');

  // Check stored token on mount
  useEffect(() => {
    const stored = apiClient.getToken();
    if (stored) {
      setToken(stored);
      checkAuth(stored);
    }
  }, []);

  const checkAuth = async (t: string) => {
    apiClient.setToken(t);
    setLoading(true);
    try {
      const resp = await apiClient.me();
      if (resp.ok) {
        const data = await resp.json();
        setScope(data.scope);
        setTenantId(data.tenantId);
        setAuthError("");
      } else {
        apiClient.clearToken();
        setToken("");
        setScope(null);
        setAuthError("Неверный токен");
      }
    } catch {
      setAuthError("Не удалось подключиться");
    }
    setLoading(false);
  };

  const handleLogin = () => {
    if (token.trim()) checkAuth(token.trim());
  };

  const handleLogout = () => {
    apiClient.clearToken();
    setToken("");
    setScope(null);
    setTenantId("");
    setSelectedDevice(null);
  };

  // Login screen
  if (!scope) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-100">
        <div className="bg-white rounded-lg shadow-sm border p-8 w-full max-w-md">
          <h1 className="text-xl font-bold mb-2">TigerMeter — панель управления</h1>
          <p className="text-sm text-neutral-500 mb-6">Введите service-токен для входа</p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="sk-..."
            className="w-full border rounded px-3 py-2 text-sm font-mono mb-3"
          />
          <button
            onClick={handleLogin}
            disabled={loading || !token.trim()}
            className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Проверка...' : 'Войти'}
          </button>
          {authError && <p className="text-red-600 text-sm mt-3">{authError}</p>}
        </div>
      </div>
    );
  }

  // Main shell
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white/70 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold tracking-tight">TigerMeter</h1>
            <span className="text-xs bg-neutral-100 px-2 py-0.5 rounded-full">
              {scope === 'ops' ? 'Админ' : tenantId}
            </span>
          </div>
          <button onClick={handleLogout} className="text-xs text-neutral-500 hover:text-red-600">
            Выйти
          </button>
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-7xl px-6 flex gap-0">
          {(['devices', 'pending', 'settings'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelectedDevice(null); }}
              className={`px-4 py-2 text-sm border-b-2 ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              {tab === 'devices' ? 'Устройства' : tab === 'pending' ? 'На одобрении' : 'Настройки'}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-6 py-6">
        {activeTab === 'devices' && (
          <div className="flex flex-col gap-6">
            <AdminPanel
              selectedDevice={selectedDevice}
              onSelectDevice={setSelectedDevice}
              scope={scope!}
            />
            {selectedDevice && (
              <FrameEditor deviceId={selectedDevice.id} scope={scope!} />
            )}
          </div>
        )}

        {activeTab === 'pending' && scope === 'ops' && (
          <PendingPanel />
        )}

        {activeTab === 'settings' && scope === 'ops' && (
          <SettingsPanel />
        )}
      </main>

      {/* Log panel at bottom */}
      <div className="mx-auto w-full max-w-7xl px-6 pb-4">
        <LogPanel />
      </div>

      <footer className="text-center text-[11px] text-neutral-500 py-4">
        © {new Date().getFullYear()} TigerMeter
      </footer>
    </div>
  );
};

// === Pending Devices Panel ===
const PendingPanel: React.FC = () => {
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [tenantId, setTenantId] = useState("tigermeter");

  const fetchPending = async () => {
    setLoading(true);
    try {
      const resp = await apiClient.listPendingDevices();
      if (resp.ok) setPending(await resp.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchPending(); }, []);

  const approve = async (id: string) => {
    await apiClient.approvePending(id, tenantId);
    fetchPending();
  };

  const reject = async (id: string) => {
    await apiClient.rejectPending(id);
    fetchPending();
  };

  return (
    <div className="bg-white rounded-md border shadow-sm">
      <div className="px-4 py-3 border-b flex items-center gap-4">
        <h2 className="font-semibold">Устройства на одобрение</h2>
        <input
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="tenantId"
          className="border rounded px-2 py-1 text-xs w-32"
        />
        <button onClick={fetchPending} className="text-xs text-blue-600">Обновить</button>
      </div>
      {loading && <div className="p-4 text-sm text-neutral-500">Загрузка...</div>}
      {!loading && pending.length === 0 && (
        <div className="p-4 text-sm text-neutral-500">Нет устройств на одобрении</div>
      )}
      {pending.map((pd: any) => (
        <div key={pd.id} className="px-4 py-3 border-b last:border-b-0 flex items-center justify-between text-sm">
          <div>
            <span className="font-mono text-xs">{pd.mac}</span>
            <span className="text-neutral-500 ml-3">FW: {pd.firmwareVersion || '?'}</span>
            <span className="text-neutral-400 ml-3">Попыток: {pd.attemptCount}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => approve(pd.id)} className="text-xs bg-green-600 text-white px-2 py-1 rounded">Одобрить</button>
            <button onClick={() => reject(pd.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">Отклонить</button>
          </div>
        </div>
      ))}
    </div>
  );
};

// === Settings Panel ===
const SettingsPanel: React.FC = () => {
  const [autoProvision, setAutoProvision] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const resp = await apiClient.getAdminSettings();
      if (resp.ok) {
        const data = await resp.json();
        setAutoProvision(data.autoProvisionNewDevices);
      }
    })();
  }, []);

  const toggle = async () => {
    setLoading(true);
    const resp = await apiClient.patchAdminSettings({ autoProvisionNewDevices: !autoProvision });
    if (resp.ok) {
      const data = await resp.json();
      setAutoProvision(data.autoProvisionNewDevices);
    }
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-md border shadow-sm p-4">
      <h2 className="font-semibold mb-4">Настройки</h2>
      <label className="flex items-center gap-3 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={autoProvision}
          onChange={toggle}
          disabled={loading}
          className="w-4 h-4"
        />
        Авто-провижининг новых устройств (без ручного одобрения)
      </label>
    </div>
  );
};

export default App;