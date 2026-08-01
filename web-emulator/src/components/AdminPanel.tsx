import React, { useEffect, useState, useCallback } from "react";
import { apiClient } from "../api/client";
import { DeviceDto, PendingDeviceDto } from "../types/display";

interface AdminPanelProps {
  selectedDevice: DeviceDto | null;
  onSelectDevice: (d: DeviceDto | null) => void;
  scope: string;
}

const POLL_INTERVAL_MS = 5000;

export const AdminPanel: React.FC<AdminPanelProps> = ({
  selectedDevice,
  onSelectDevice,
  scope,
}) => {
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const isOps = scope === 'ops';

  const fetchDevices = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.listDevices();
      if (resp.ok) {
        const data = await resp.json();
        setDevices(data);
        // Update selected if still exists
        if (selectedDevice) {
          const updated = data.find((d: DeviceDto) => d.id === selectedDevice.id);
          if (updated) onSelectDevice(updated);
          else onSelectDevice(null);
        }
      } else {
        setError(`Error ${resp.status}`);
      }
    } catch (e: any) {
      setError(e.message);
    }
    if (showLoading) setLoading(false);
  }, [selectedDevice, onSelectDevice]);

  useEffect(() => {
    fetchDevices(true);
    const iv = setInterval(() => fetchDevices(false), POLL_INTERVAL_MS);
    return () => clearInterval(iv);
  }, []);

  const handleRevoke = async (id: string) => {
    if (!confirm("Отозвать это устройство?")) return;
    await apiClient.revokeDevice(id);
    fetchDevices(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить это устройство безвозвратно?")) return;
    await apiClient.deleteDevice(id);
    if (selectedDevice?.id === id) onSelectDevice(null);
    fetchDevices(false);
  };

  const handleFactoryReset = async (id: string) => {
    if (!confirm("Поставить устройство на сброс к заводским настройкам?")) return;
    await apiClient.factoryReset(id);
    fetchDevices(false);
  };

  const handleToggleAutoUpdate = async (d: DeviceDto) => {
    await apiClient.updateDeviceSettings(d.id, { autoUpdate: !d.autoUpdate });
    fetchDevices(false);
  };

  const handleToggleDemoMode = async (d: DeviceDto) => {
    await apiClient.updateDeviceSettings(d.id, { demoMode: !d.demoMode });
    fetchDevices(false);
  };

  const handleSaveName = async (id: string) => {
    await apiClient.patchDevice(id, { name: editName });
    setEditName("");
    fetchDevices(false);
  };

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleString() : '-';
  const isOnline = (ls: string | null) => ls ? Date.now() - new Date(ls).getTime() < 120000 : false;

  return (
    <div className="bg-white rounded-md border shadow-sm">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="font-semibold">Устройства ({devices.length})</h2>
        <button onClick={() => fetchDevices(true)} className="text-xs text-blue-600">
          {loading ? 'Загрузка...' : 'Обновить'}
        </button>
      </div>
      {error && <div className="px-4 py-2 text-sm text-red-600">{error}</div>}

      {/* Device list */}
      <div className="divide-y max-h-[500px] overflow-y-auto">
        {devices.length === 0 && !loading && (
          <div className="px-4 py-8 text-sm text-neutral-500 text-center">Нет устройств</div>
        )}
        {devices.map((d) => (
          <div
            key={d.id}
            onClick={() => onSelectDevice(d)}
            className={`px-4 py-3 text-sm cursor-pointer hover:bg-neutral-50 flex items-center gap-4 ${
              selectedDevice?.id === d.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isOnline(d.lastSeen) ? 'bg-green-500' : 'bg-neutral-300'}`} />
            <span className="font-mono text-xs">{d.mac}</span>
            <span className="text-neutral-500 truncate max-w-[120px]">{d.name || '-'}</span>
            {isOps && d.tenantId && (
              <span className="text-xs bg-neutral-100 px-1.5 py-0.5 rounded">{d.tenantId}</span>
            )}
            <span className="text-xs text-neutral-400">{d.status}</span>
            <span className="text-xs text-neutral-400 ml-auto">v{d.firmwareVersion || '?'}</span>
          </div>
        ))}
      </div>

      {/* Device detail */}
      {selectedDevice && (
        <div className="border-t p-4">
          <h3 className="font-semibold mb-3">Устройство: {selectedDevice.mac}</h3>
          <div className="grid grid-cols-2 gap-2 text-sm mb-4">
            <div><span className="text-neutral-500">ID:</span> <span className="font-mono text-xs">{selectedDevice.id}</span></div>
            <div><span className="text-neutral-500">Статус:</span> {selectedDevice.status}</div>
            <div><span className="text-neutral-500">FW:</span> v{selectedDevice.firmwareVersion || '?'}</div>
            <div><span className="text-neutral-500">Батарея:</span> {selectedDevice.battery ?? '?'}%</div>
            <div><span className="text-neutral-500">Версия дисплея:</span> {selectedDevice.displayVersion}</div>
            <div><span className="text-neutral-500">Хеш дисплея:</span> <span className="font-mono text-xs">{selectedDevice.displayHash?.slice(0, 12) ?? '-'}</span></div>
            {isOps && selectedDevice.tenantId && (
              <div><span className="text-neutral-500">Тенант:</span> {selectedDevice.tenantId}</div>
            )}
            {isOps && selectedDevice.externalUserId && (
              <div><span className="text-neutral-500">Внешний пользователь:</span> {selectedDevice.externalUserId}</div>
            )}
            <div><span className="text-neutral-500">Последняя активность:</span> {formatDate(selectedDevice.lastSeen)}</div>
          </div>

          {/* Name edit */}
          <div className="flex gap-2 items-end mb-3">
            <div className="flex-1">
              <label className="text-xs text-neutral-500">Название</label>
              <input
                value={editName || selectedDevice.name || ''}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveName(selectedDevice.id)}
                placeholder="Название устройства"
                className="w-full border rounded px-2 py-1 text-sm"
              />
            </div>
            <button onClick={() => handleSaveName(selectedDevice.id)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded">Сохранить</button>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => handleToggleAutoUpdate(selectedDevice)} className={`text-xs px-2 py-1 rounded ${selectedDevice.autoUpdate ? 'bg-green-100 text-green-700' : 'bg-neutral-100'}`}>
              Автообновление: {selectedDevice.autoUpdate ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
            <button onClick={() => handleToggleDemoMode(selectedDevice)} className={`text-xs px-2 py-1 rounded ${selectedDevice.demoMode ? 'bg-purple-100 text-purple-700' : 'bg-neutral-100'}`}>
              Демо: {selectedDevice.demoMode ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
            {isOps && (
              <>
                <button onClick={() => handleRevoke(selectedDevice.id)} className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">Отозвать</button>
                <button onClick={() => handleFactoryReset(selectedDevice.id)} className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">Сброс</button>
                <button onClick={() => handleDelete(selectedDevice.id)} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">Удалить</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};