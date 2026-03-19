import React, { useEffect, useState, useCallback, useRef } from "react";
import { apiClient } from "../api/client";
import { createTestAdminToken, createTestUserToken } from "../utils/jwt";
import { 
  DisplayInstruction,
  FontSize, 
  TextAlign, 
  LedColor, 
  LedBrightness,
  DISPLAY_DEFAULTS 
} from "../types/display";

export interface Device {
  id: string;
  mac: string;
  userId: string | null;
  status: string;
  lastSeen: string | null;
  battery: number | null;
  firmwareVersion: string | null;
  autoUpdate: boolean;
  demoMode: boolean;
  displayHash: string | null;
  displayInstruction?: DisplayInstruction | null;
  createdAt?: string;
}

interface PendingDevice {
  id: string;
  mac: string;
  firmwareVersion: string | null;
  ip: string | null;
  firstSeen: string;
  lastSeen: string;
  attemptCount: number;
  status: string;
}

interface AdminPanelProps {
  selectedDevice: Device | null;
  onSelectDevice: (device: Device | null) => void;
  onPreviewChange?: (instruction: DisplayInstruction | null) => void;
}

const POLL_INTERVAL_MS = 5000;

// Derive WiFi SSID from MAC address (same logic as firmware)
const getWifiSsid = (mac: string) => {
  const suffix = mac.replace(/:/g, "").slice(-4);
  return `tigermeter-${suffix}`;
};

// Form state for display settings
interface DisplayForm {
  symbol: string;
  symbolFontSize: FontSize;
  symbolImage: string;
  symbolCarousel: boolean;
  topLine: string;
  topLineFontSize: FontSize;
  topLineAlign: TextAlign;
  topLineShowDate: boolean;
  mainText: string;
  mainTextFontSize: FontSize;
  mainTextAlign: TextAlign;
  bottomLine: string;
  bottomLineFontSize: FontSize;
  bottomLineAlign: TextAlign;
  ledColor: LedColor;
  ledBrightness: LedBrightness;
  beep: boolean;
  flashCount: number;
  refreshInterval: number;
  timezoneOffset: number;
}

// Font size presets for the select dropdown
const FONT_SIZE_PRESETS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40];

const DEFAULT_FORM: DisplayForm = {
  symbol: "$",
  symbolFontSize: 24,
  symbolImage: "",
  symbolCarousel: true,
  topLine: "",
  topLineFontSize: 16,
  topLineAlign: "center",
  topLineShowDate: false,
  mainText: "Настройте\\nдисплей",
  mainTextFontSize: 24,
  mainTextAlign: "center",
  bottomLine: "tigermeter.com",
  bottomLineFontSize: 16,
  bottomLineAlign: "center",
  ledColor: "rainbow",
  ledBrightness: "low",
  beep: false,
  flashCount: 0,
  refreshInterval: 30,
  timezoneOffset: 3, // Moscow UTC+3
};

export const AdminPanel: React.FC<AdminPanelProps> = ({
  selectedDevice,
  onSelectDevice,
  onPreviewChange,
}) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pendingDevices, setPendingDevices] = useState<PendingDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin settings (auto-provision)
  const [autoProvisionNewDevices, setAutoProvisionNewDevices] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);


  // Attach form
  const [attachCode, setAttachCode] = useState("");
  const [attachStatus, setAttachStatus] = useState<string | null>(null);

  // Logo library
  const [logos, setLogos] = useState<{id: string; name: string; createdAt: string}[]>([]);
  const [logoName, setLogoName] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoStatus, setLogoStatus] = useState<string | null>(null);

  // Display form
  const [form, setForm] = useState<DisplayForm>(DEFAULT_FORM);
  const [formDirty, setFormDirty] = useState(false);
  const [displayStatus, setDisplayStatus] = useState<string | null>(null);
  const lastDeviceIdRef = useRef<string | null>(null);

  // Refs for polling
  const pollingRef = useRef<number | null>(null);

  // Helper to normalize font size from API (may be string or number)
  const normalizeFontSize = (size: any, defaultSize: number): number => {
    if (typeof size === 'number') return size;
    // Convert legacy string values to numbers
    if (size === 'small') return 16;
    if (size === 'mid') return 20;
    if (size === 'large') return 32;
    return defaultSize;
  };

  // Helper to fill form from device instruction
  const fillFormFromDevice = useCallback((device: Device | null) => {
    if (device?.displayInstruction) {
      const s = device.displayInstruction;
      setForm({
        symbol: s.symbol || DEFAULT_FORM.symbol,
        symbolFontSize: normalizeFontSize(s.symbolFontSize, 24),
        symbolImage: s.symbolImage || "",
        symbolCarousel: s.symbolCarousel || false,
        topLine: s.topLine || "",
        topLineFontSize: normalizeFontSize(s.topLineFontSize, 16),
        topLineAlign: s.topLineAlign || "center",
        topLineShowDate: s.topLineShowDate || false,
        mainText: s.mainText || DEFAULT_FORM.mainText,
        mainTextFontSize: normalizeFontSize(s.mainTextFontSize, 32),
        mainTextAlign: s.mainTextAlign || "center",
        bottomLine: s.bottomLine || "",
        bottomLineFontSize: normalizeFontSize(s.bottomLineFontSize, 16),
        bottomLineAlign: s.bottomLineAlign || "center",
        ledColor: s.ledColor || "green",
        ledBrightness: s.ledBrightness || "mid",
        beep: false, // Always reset one-time actions
        flashCount: 0,
        refreshInterval: s.refreshInterval || 30,
        timezoneOffset: s.timezoneOffset ?? 3,
      });
    } else if (device) {
      setForm(DEFAULT_FORM);
    }
  }, []);

  // Update form when selected device changes (only if not dirty or device changed)
  useEffect(() => {
    const deviceChanged = selectedDevice?.id !== lastDeviceIdRef.current;
    if (deviceChanged) {
      // New device selected - always fill form and reset dirty flag
      lastDeviceIdRef.current = selectedDevice?.id ?? null;
      setFormDirty(false);
      fillFormFromDevice(selectedDevice);
    }
    // If same device but form is dirty - don't overwrite user's edits
  }, [selectedDevice?.id, selectedDevice?.displayInstruction, fillFormFromDevice]);

  // Reset form to device values
  const resetForm = useCallback(() => {
    setFormDirty(false);
    fillFormFromDevice(selectedDevice);
    setDisplayStatus(null);
  }, [selectedDevice, fillFormFromDevice]);

  // Update preview whenever form changes
  useEffect(() => {
    if (!selectedDevice) {
      onPreviewChange?.(null);
      return;
    }
    const instruction: DisplayInstruction = {
      version: 1,
      hash: "",
      symbol: form.symbol,
      symbolFontSize: form.symbolFontSize,
      symbolImage: form.symbolImage || undefined,
      symbolCarousel: form.symbolCarousel || undefined,
      mainText: form.mainText,
      topLine: form.topLine || undefined,
      topLineFontSize: form.topLineFontSize,
      topLineAlign: form.topLineAlign,
      topLineShowDate: form.topLineShowDate || undefined,
      mainTextFontSize: form.mainTextFontSize,
      mainTextAlign: form.mainTextAlign,
      bottomLine: form.bottomLine || undefined,
      bottomLineFontSize: form.bottomLineFontSize,
      bottomLineAlign: form.bottomLineAlign,
      ledColor: form.ledColor,
      ledBrightness: form.ledBrightness,
      refreshInterval: form.refreshInterval,
      timezoneOffset: form.timezoneOffset,
    };
    onPreviewChange?.(instruction);
  }, [form, selectedDevice, onPreviewChange]);

  const updateForm = (updates: Partial<DisplayForm>) => {
    setFormDirty(true);
    setForm(prev => ({ ...prev, ...updates }));
  };

  const fetchDevices = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.listDevicesAdmin(adminToken);
      if (response.ok) {
        const data = await response.json();
        // Parse displayInstructionJson string into displayInstruction object
        const devicesWithParsed = data.map((d: any) => ({
          ...d,
          displayInstruction: d.displayInstructionJson 
            ? JSON.parse(d.displayInstructionJson) 
            : null
        }));
        setDevices(devicesWithParsed);
        if (selectedDevice) {
          const updated = devicesWithParsed.find((d: Device) => d.id === selectedDevice.id);
          if (updated) {
            onSelectDevice(updated);
          } else {
            onSelectDevice(null);
          }
        }
      } else {
        const err = await response.json().catch(() => ({}));
        setError(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [selectedDevice, onSelectDevice]);

  const fetchPendingDevices = useCallback(async () => {
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.listPendingDevicesAdmin(adminToken);
      if (response.ok) {
        const data = await response.json();
        setPendingDevices(data);
      }
    } catch (e: any) {
      console.error(e);
    }
  }, []);

  const fetchAdminSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.getAdminSettings(adminToken);
      if (response.ok) {
        const data = await response.json();
        setAutoProvisionNewDevices(data.autoProvisionNewDevices === true);
      } else {
        setSettingsError("Не удалось загрузить настройки");
      }
    } catch (e: any) {
      setSettingsError(e.message || "Не удалось загрузить настройки");
    }
  }, []);

  const handleToggleAutoProvision = async () => {
    const next = !autoProvisionNewDevices;
    setSettingsLoading(true);
    setSettingsError(null);
    const prev = autoProvisionNewDevices;
    setAutoProvisionNewDevices(next);
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.patchAdminSettings(adminToken, { autoProvisionNewDevices: next });
      if (response.ok) {
        const data = await response.json();
        setAutoProvisionNewDevices(data.autoProvisionNewDevices === true);
      } else {
        setAutoProvisionNewDevices(prev);
        const err = await response.json().catch(() => ({}));
        setSettingsError(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      setAutoProvisionNewDevices(prev);
      setSettingsError(e.message || "Не удалось обновить");
    } finally {
      setSettingsLoading(false);
    }
  };

  const fetchLogos = useCallback(async () => {
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.listLogos(adminToken);
      if (response.ok) {
        setLogos(await response.json());
      }
    } catch (_) {}
  }, []);

  const handleUploadLogo = async () => {
    if (!logoFile || !logoName) {
      setLogoStatus("Укажите имя и файл");
      return;
    }
    setLogoStatus("Загрузка...");
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.uploadLogo(logoFile, logoName, adminToken);
      if (response.ok) {
        setLogoStatus("✓ Загружено");
        setLogoName("");
        setLogoFile(null);
        fetchLogos();
      } else {
        const err = await response.json().catch(() => ({}));
        setLogoStatus(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      setLogoStatus(e.message);
    }
  };

  const handleDeleteLogo = async (id: string) => {
    try {
      const adminToken = await createTestAdminToken();
      await apiClient.deleteLogo(id, adminToken);
      fetchLogos();
    } catch (_) {}
  };

  useEffect(() => {
    fetchDevices(true);
    fetchPendingDevices();
    fetchLogos();
    fetchAdminSettings();
  }, []);

  useEffect(() => {
    const poll = () => {
      fetchDevices(false);
      fetchPendingDevices();
    };
    pollingRef.current = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchDevices, fetchPendingDevices]);

  const handleApprovePending = async (pd: PendingDevice) => {
    if (!confirm(`Одобрить устройство ${pd.mac}?`)) return;
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.approvePendingDevice(pd.id, adminToken);
      if (response.ok) {
        fetchPendingDevices();
        fetchDevices(false);
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleRejectPending = async (pd: PendingDevice) => {
    if (!confirm(`Отклонить устройство ${pd.mac}?`)) return;
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.rejectPendingDevice(pd.id, adminToken);
      if (response.ok) {
        fetchPendingDevices();
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleAttach = async () => {
    if (!attachCode || attachCode.length !== 6) {
      setAttachStatus("Неверный код (6 цифр)");
      return;
    }
    setAttachStatus("Привязка...");
    try {
      const userToken = await createTestUserToken();
      const response = await apiClient.attachClaim(attachCode, userToken);
      if (response.ok) {
        setAttachStatus("✓ Код привязан");
        setAttachCode("");
        fetchDevices(false);
      } else {
        const err = await response.json().catch(() => ({}));
        setAttachStatus(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      setAttachStatus(e.message);
    }
  };

  const handleRevoke = async (device: Device) => {
    if (!confirm(`Отозвать устройство ${device.mac}?`)) return;
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.revokeDeviceAdmin(device.id, adminToken);
      if (response.ok) {
        fetchDevices(false);
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDelete = async (device: Device) => {
    if (!confirm(`Удалить устройство ${device.mac} навсегда?`)) return;
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.deleteDeviceAdmin(device.id, adminToken);
      if (response.ok) {
        if (selectedDevice?.id === device.id) {
          onSelectDevice(null);
        }
        fetchDevices(false);
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleFactoryReset = async (device: Device) => {
    if (!confirm(`Сбросить устройство ${device.mac} к заводским настройкам?`)) return;
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.factoryResetAdmin(device.id, adminToken);
      if (response.ok) {
        alert(`Сброс поставлен в очередь для ${device.mac}`);
        fetchDevices(false);
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleToggleAutoUpdate = async (device: Device) => {
    const newValue = !device.autoUpdate;
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.updateDeviceSettings(device.id, adminToken, { autoUpdate: newValue });
      if (response.ok) {
        fetchDevices(false);
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleToggleDemoMode = async (device: Device) => {
    const newValue = !device.demoMode;
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.updateDeviceSettings(device.id, adminToken, { demoMode: newValue });
      if (response.ok) {
        fetchDevices(false);
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSetDisplay = async () => {
    if (!selectedDevice) {
      setDisplayStatus("Сначала выберите устройство");
      return;
    }
    setDisplayStatus("Отправка...");
    try {
      const instruction: DisplayInstruction = {
        version: 1,
        hash: "",
        symbol: form.symbol,
        symbolFontSize: form.symbolFontSize,
        symbolImage: form.symbolImage || undefined,
        symbolCarousel: form.symbolCarousel || undefined,
        mainText: form.mainText,
        topLine: form.topLine || undefined,
        topLineFontSize: form.topLineFontSize,
        topLineAlign: form.topLineAlign,
        topLineShowDate: form.topLineShowDate || undefined,
        mainTextFontSize: form.mainTextFontSize,
        mainTextAlign: form.mainTextAlign,
        bottomLine: form.bottomLine || undefined,
        bottomLineFontSize: form.bottomLineFontSize,
        bottomLineAlign: form.bottomLineAlign,
        ledColor: form.ledColor,
        ledBrightness: form.ledBrightness,
        beep: form.beep || undefined,
        flashCount: form.flashCount > 0 ? form.flashCount : undefined,
        refreshInterval: form.refreshInterval,
        timezoneOffset: form.timezoneOffset,
      };

      const hash = await apiClient.computeDisplayHash(instruction);
      instruction.hash = hash;

      const userToken = await createTestUserToken();
      const response = await apiClient.setDisplay(
        selectedDevice.id,
        userToken,
        instruction
      );

      if (response.ok) {
        setDisplayStatus("✓ Дисплей обновлён");
        // Reset one-time actions and dirty flag
        setForm(prev => ({ ...prev, beep: false, flashCount: 0 }));
        setFormDirty(false);
        fetchDevices(false);
      } else {
        const err = await response.json().catch(() => ({}));
        setDisplayStatus(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      setDisplayStatus(e.message);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString();
  };

  const isOnline = (lastSeen: string | null) => {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 2 * 60 * 1000;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-100 text-green-800";
      case "awaiting_claim": return "bg-yellow-100 text-yellow-800";
      case "revoked": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  // Shared select styles
  const selectClass = "w-full border px-2 py-1 rounded text-xs bg-white";
  const inputClass = "w-full border px-2 py-1 rounded text-xs";
  const labelClass = "block text-[10px] font-medium mb-1 text-neutral-600";

  return (
    <div className="flex flex-col gap-4">
      {/* Auto-provision toggle */}
      <div className="bg-white rounded-md border border-neutral-200 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-800">Автоматически добавлять новые устройства</h2>
            <p className="text-[10px] text-neutral-500 mt-0.5">Когда включено, новые устройства получают claim-код сразу, без одобрения в списке ожидания.</p>
          </div>
          <button
            role="switch"
            aria-checked={autoProvisionNewDevices}
            onClick={handleToggleAutoProvision}
            disabled={settingsLoading}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${autoProvisionNewDevices ? "bg-green-600" : "bg-neutral-300"}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${autoProvisionNewDevices ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
        {settingsError && <div className="text-[10px] text-red-600 mt-2">{settingsError}</div>}
      </div>

      {/* Pending Devices */}
      <div className="bg-amber-50 rounded-md border border-amber-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-amber-900">Ожидающие устройства</h2>
          <button onClick={() => fetchPendingDevices()} className="text-xs px-2 py-1 rounded bg-amber-100 hover:bg-amber-200">
            Обновить
          </button>
        </div>
        {pendingDevices.length === 0 ? (
          <div className="text-xs text-amber-700">Нет ожидающих устройств</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-amber-200">
                <th className="text-left py-2">MAC</th>
                <th className="text-left py-2">Прошивка</th>
                <th className="text-left py-2">Последняя активность</th>
                <th className="text-left py-2">Действия</th>
              </tr>
            </thead>
            <tbody>
              {pendingDevices.map((pd) => (
                <tr key={pd.id} className="border-b border-amber-100">
                  <td className="py-2 font-mono whitespace-nowrap">{pd.mac}</td>
                  <td className="py-2">{pd.firmwareVersion || '-'}</td>
                  <td className="py-2">{formatDate(pd.lastSeen)}</td>
                  <td className="py-2 flex gap-2">
                    <button onClick={() => handleApprovePending(pd)} className="text-green-600 hover:text-green-800 font-medium">✓ Одобрить</button>
                    <button onClick={() => handleRejectPending(pd)} className="text-red-600 hover:text-red-800">Отклонить</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Devices Table */}
      <div className="bg-white rounded-md border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Устройства</h2>
          <button onClick={() => fetchDevices(true)} disabled={loading} className="text-xs px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 disabled:opacity-50">
            {loading ? "Загрузка..." : "Обновить"}
          </button>
        </div>
        {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-1">MAC</th>
                <th className="text-left py-2 px-1">WiFi</th>
                <th className="text-left py-2 px-1">Статус</th>
                <th className="text-left py-2 px-1">Прошивка</th>
                <th className="text-left py-2 px-1">Авто-обновление</th>
                <th className="text-left py-2 px-1">Демо</th>
                <th className="text-left py-2 px-1">Последняя активность</th>
                <th className="text-left py-2 px-1">Батарея</th>
                <th className="text-left py-2 px-1">Действия</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && !loading && (
                <tr><td colSpan={9} className="py-4 text-center text-neutral-500">Устройства не найдены</td></tr>
              )}
              {devices.map((device) => (
                <tr
                  key={device.id}
                  className={`border-b hover:bg-neutral-50 cursor-pointer ${selectedDevice?.id === device.id ? "bg-blue-50" : ""}`}
                  onClick={() => onSelectDevice(device)}
                >
                  <td className="py-2 px-1 font-mono whitespace-nowrap"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${isOnline(device.lastSeen) ? 'bg-green-500' : 'bg-neutral-300'}`} />{device.mac}</td>
                  <td className="py-2 px-1 font-mono text-[10px] whitespace-nowrap">{getWifiSsid(device.mac)}</td>
                  <td className="py-2 px-1">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${getStatusColor(device.status)}`}>{device.status}</span>
                  </td>
                  <td className="py-2 px-1 font-mono text-[10px]">{device.firmwareVersion || "-"}</td>
                  <td className="py-2 px-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleAutoUpdate(device); }}
                      className={`px-2 py-0.5 rounded text-[10px] ${device.autoUpdate ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                    >
                      {device.autoUpdate ? 'ВКЛ' : 'ВЫКЛ'}
                    </button>
                  </td>
                  <td className="py-2 px-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleDemoMode(device); }}
                      className={`px-2 py-0.5 rounded text-[10px] ${device.demoMode ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                    >
                      {device.demoMode ? 'ДЕМО' : 'ВЫКЛ'}
                    </button>
                  </td>
                  <td className="py-2 px-1">{formatDate(device.lastSeen)}</td>
                  <td className="py-2 px-1">{device.battery != null ? `${device.battery}%` : "-"}</td>
                  <td className="py-2 px-1 flex gap-2">
                    {device.status === "active" && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); handleRevoke(device); }} className="text-orange-600 hover:text-orange-800">Отозвать</button>
                        <button onClick={(e) => { e.stopPropagation(); handleFactoryReset(device); }} className="text-red-600 hover:text-red-800">Сброс</button>
                      </>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(device); }} className="text-neutral-500 hover:text-red-600">Удалить</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>


      {/* Logo Library - collapsible */}
      <details className="bg-white rounded-md border shadow-sm">
        <summary className="px-4 py-2 text-xs text-neutral-500 cursor-pointer hover:text-neutral-700 select-none">
          Библиотека логотипов {logos.length > 0 && <span className="text-neutral-400">({logos.length})</span>}
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-3">
          {logos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {logos.map(logo => (
                <div key={logo.id} className="flex items-center gap-1 bg-neutral-100 rounded px-2 py-1 text-xs">
                  <span className="font-mono">{logo.name}</span>
                  <button onClick={() => handleDeleteLogo(logo.id)} className="text-red-400 hover:text-red-600 ml-1">&times;</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className={labelClass}>Название</label>
              <input type="text" value={logoName} onChange={(e) => setLogoName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="my-logo" className={inputClass} />
            </div>
            <div className="flex-1">
              <label className={labelClass}>Файл (SVG/PNG)</label>
              <input type="file" accept=".svg,.png,.jpg,.bmp,image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} className="text-xs" />
            </div>
            <button onClick={handleUploadLogo} className="px-3 py-1 bg-neutral-800 text-white text-xs rounded hover:bg-black">Загрузить</button>
          </div>
          {logoStatus && <div className="text-[10px] mt-1 text-neutral-600">{logoStatus}</div>}
        </div>
      </details>

      {/* Attach Form - only for awaiting_claim devices */}
      {selectedDevice && selectedDevice.status === 'awaiting_claim' && (
        <div className="bg-white rounded-md border border-blue-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold mb-3">
            Привязать код <span className="font-normal text-neutral-500">— {selectedDevice.mac}</span>
          </h2>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className={labelClass}>6-значный код</label>
              <input type="text" value={attachCode} onChange={(e) => setAttachCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className={`${inputClass} font-mono tracking-widest text-center`} maxLength={6} />
            </div>
            <button onClick={handleAttach} className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Привязать</button>
          </div>
          {attachStatus && <div className="text-[10px] mt-2 text-neutral-600">{attachStatus}</div>}
        </div>
      )}

      {/* Display Editor - Only shown when device selected */}
      {selectedDevice && (
        <div className="bg-white rounded-md border p-4 shadow-sm">
          <h2 className="text-sm font-semibold mb-4">
            Настройки дисплея <span className="font-normal text-neutral-500">— {selectedDevice.mac}</span>
          </h2>

          <div className="grid grid-cols-12 gap-3">
            {/* Symbol */}
            <div className="col-span-2">
              <label className={labelClass}>Символ</label>
              <input value={form.symbol} onChange={(e) => updateForm({ symbol: e.target.value })} className={inputClass} placeholder="BTC" disabled={form.symbolCarousel} />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Размер символа</label>
              <select value={form.symbolFontSize} onChange={(e) => updateForm({ symbolFontSize: parseInt(e.target.value) })} className={selectClass} disabled={form.symbolCarousel}>
                {FONT_SIZE_PRESETS.map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            <div className="col-span-4">
              <label className={labelClass}>Логотип</label>
              <select value={form.symbolImage} onChange={(e) => updateForm({ symbolImage: e.target.value })} className={selectClass} disabled={form.symbolCarousel}>
                <option value="">Нет (текст)</option>
                <optgroup label="Встроенные">
                  <option value="dollar">$ Dollar</option>
                  <option value="euro">€ Euro</option>
                  <option value="pound">£ Pound</option>
                  <option value="yuan">¥ Yuan</option>
                  <option value="ruble">₽ Ruble</option>
                  <option value="bitcoin">₿ Bitcoin</option>
                  <option value="eth">Ξ Ethereum</option>
                  <option value="binance">Binance</option>
                </optgroup>
                {logos.length > 0 && (
                  <optgroup label="Пользовательские">
                    {logos.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="col-span-4 flex items-center gap-2 mt-1">
              <input type="checkbox" id="symbolCarousel" checked={form.symbolCarousel} onChange={(e) => updateForm({ symbolCarousel: e.target.checked })} />
              <label htmlFor="symbolCarousel" className="text-xs text-neutral-600">Карусель символов ($, €, £, ¥, ₽, ₿, Ξ, Binance)</label>
            </div>

            {/* Refresh Interval */}
            <div className="col-span-3">
              <label className={labelClass}>Обновление (сек)</label>
              <input 
                type="text" 
                inputMode="numeric"
                value={form.refreshInterval} 
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  updateForm({ refreshInterval: val ? Math.max(5, parseInt(val)) : 5 });
                }} 
                className={inputClass} 
              />
            </div>

            {/* Timezone */}
            <div className="col-span-3">
              <label className={labelClass}>Часовой пояс</label>
              <select value={form.timezoneOffset} onChange={(e) => updateForm({ timezoneOffset: parseInt(e.target.value) })} className={inputClass}>
                <option value={-12}>UTC-12</option>
                <option value={-11}>UTC-11</option>
                <option value={-10}>UTC-10 Hawaii</option>
                <option value={-9}>UTC-9 Alaska</option>
                <option value={-8}>UTC-8 LA</option>
                <option value={-7}>UTC-7 Denver</option>
                <option value={-6}>UTC-6 Chicago</option>
                <option value={-5}>UTC-5 New York</option>
                <option value={-4}>UTC-4</option>
                <option value={-3}>UTC-3</option>
                <option value={-2}>UTC-2</option>
                <option value={-1}>UTC-1</option>
                <option value={0}>UTC+0 London</option>
                <option value={1}>UTC+1 Paris</option>
                <option value={2}>UTC+2 Kyiv</option>
                <option value={3}>UTC+3 Moscow</option>
                <option value={4}>UTC+4 Dubai</option>
                <option value={5}>UTC+5</option>
                <option value={5.5}>UTC+5:30 India</option>
                <option value={6}>UTC+6</option>
                <option value={7}>UTC+7 Bangkok</option>
                <option value={8}>UTC+8 Singapore</option>
                <option value={9}>UTC+9 Tokyo</option>
                <option value={10}>UTC+10 Sydney</option>
                <option value={11}>UTC+11</option>
                <option value={12}>UTC+12</option>
              </select>
            </div>

            <div className="col-span-3" />

            {/* Top Line Section */}
            <div className="col-span-12 border-t pt-3 mt-1">
              <div className="text-[10px] font-semibold text-neutral-500 mb-2">ВЕРХНЯЯ СТРОКА</div>
            </div>
            
            <div className="col-span-4">
              <label className={labelClass}>Текст</label>
              <input 
                value={form.topLine} 
                onChange={(e) => updateForm({ topLine: e.target.value })} 
                className={inputClass} 
                placeholder="Текст верхней строки"
                disabled={form.topLineShowDate}
              />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Размер шрифта</label>
              <select value={form.topLineFontSize} onChange={(e) => updateForm({ topLineFontSize: parseInt(e.target.value) })} className={selectClass}>
                {FONT_SIZE_PRESETS.map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Выравнивание</label>
              <select value={form.topLineAlign} onChange={(e) => updateForm({ topLineAlign: e.target.value as TextAlign })} className={selectClass}>
                <option value="left">Лево</option>
                <option value="center">Центр</option>
                <option value="right">Право</option>
              </select>
            </div>
            <div className="col-span-4 flex items-end">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={form.topLineShowDate} onChange={(e) => updateForm({ topLineShowDate: e.target.checked })} className="rounded" />
                Показывать дату/время
              </label>
            </div>

            {/* Main Text Section */}
            <div className="col-span-12 border-t pt-3 mt-1">
              <div className="text-[10px] font-semibold text-neutral-500 mb-2">ОСНОВНОЙ ТЕКСТ</div>
            </div>

            <div className="col-span-6">
              <label className={labelClass}>Текст</label>
              <input value={form.mainText} onChange={(e) => updateForm({ mainText: e.target.value })} className={inputClass} placeholder="Основной текст" />
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Размер шрифта</label>
              <select value={form.mainTextFontSize} onChange={(e) => updateForm({ mainTextFontSize: parseInt(e.target.value) })} className={selectClass}>
                {FONT_SIZE_PRESETS.map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Выравнивание</label>
              <select value={form.mainTextAlign} onChange={(e) => updateForm({ mainTextAlign: e.target.value as TextAlign })} className={selectClass}>
                <option value="left">Лево</option>
                <option value="center">Центр</option>
                <option value="right">Право</option>
              </select>
            </div>

            {/* Bottom Line Section */}
            <div className="col-span-12 border-t pt-3 mt-1">
              <div className="text-[10px] font-semibold text-neutral-500 mb-2">НИЖНЯЯ СТРОКА</div>
            </div>

            <div className="col-span-6">
              <label className={labelClass}>Текст</label>
              <input value={form.bottomLine} onChange={(e) => updateForm({ bottomLine: e.target.value })} className={inputClass} placeholder="Текст нижней строки" />
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Размер шрифта</label>
              <select value={form.bottomLineFontSize} onChange={(e) => updateForm({ bottomLineFontSize: parseInt(e.target.value) })} className={selectClass}>
                {FONT_SIZE_PRESETS.map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Выравнивание</label>
              <select value={form.bottomLineAlign} onChange={(e) => updateForm({ bottomLineAlign: e.target.value as TextAlign })} className={selectClass}>
                <option value="left">Лево</option>
                <option value="center">Центр</option>
                <option value="right">Право</option>
              </select>
            </div>

            {/* LED Section */}
            <div className="col-span-12 border-t pt-3 mt-1">
              <div className="text-[10px] font-semibold text-neutral-500 mb-2">СВЕТОДИОД</div>
            </div>

            <div className="col-span-3">
              <label className={labelClass}>Цвет</label>
              <select value={form.ledColor} onChange={(e) => updateForm({ ledColor: e.target.value as LedColor })} className={selectClass}>
                <option value="green">Зелёный</option>
                <option value="red">Красный</option>
                <option value="blue">Синий</option>
                <option value="yellow">Жёлтый</option>
                <option value="purple">Фиолетовый</option>
                <option value="rainbow">Радуга</option>
              </select>
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Яркость</label>
              <select value={form.ledBrightness} onChange={(e) => updateForm({ ledBrightness: e.target.value as LedBrightness })} className={selectClass}>
                <option value="off">Выкл</option>
                <option value="low">Низкая</option>
                <option value="mid">Средняя</option>
                <option value="high">Высокая</option>
              </select>
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Кол-во вспышек</label>
              <input 
                type="text" 
                inputMode="numeric"
                value={form.flashCount} 
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  updateForm({ flashCount: val ? Math.min(100, parseInt(val)) : 0 });
                }} 
                className={inputClass} 
              />
            </div>
            <div className="col-span-3 flex items-end">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={form.beep} onChange={(e) => updateForm({ beep: e.target.checked })} className="rounded" />
                Звуковой сигнал
              </label>
            </div>

            {/* Submit */}
            <div className="col-span-12 border-t pt-3 mt-1 flex justify-between items-center">
              <div className="text-[10px] text-neutral-500 flex items-center gap-2">
                {formDirty && <span className="text-amber-600">● Несохранённые изменения</span>}
                {displayStatus}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={resetForm}
                  disabled={!formDirty}
                  className="px-3 py-2 bg-neutral-200 text-neutral-700 text-xs rounded hover:bg-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Сбросить
                </button>
                <button
                  onClick={handleSetDisplay}
                  disabled={selectedDevice.status !== "active"}
                  className="px-4 py-2 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Отправить на устройство
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
