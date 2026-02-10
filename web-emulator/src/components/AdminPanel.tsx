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
  symbol: "SYM",
  symbolFontSize: 24,
  topLine: "",
  topLineFontSize: 16,
  topLineAlign: "center",
  topLineShowDate: false,
  mainText: "Hello",
  mainTextFontSize: 32,
  mainTextAlign: "center",
  bottomLine: "",
  bottomLineFontSize: 16,
  bottomLineAlign: "center",
  ledColor: "green",
  ledBrightness: "mid",
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

  // Provision form
  const [provisionMac, setProvisionMac] = useState("");
  const [provisionFw, setProvisionFw] = useState("1.0.0");
  const [provisionStatus, setProvisionStatus] = useState<string | null>(null);

  // Attach form
  const [attachCode, setAttachCode] = useState("");
  const [attachStatus, setAttachStatus] = useState<string | null>(null);

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

  useEffect(() => {
    fetchDevices(true);
    fetchPendingDevices();
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
    if (!confirm(`Approve device ${pd.mac}?`)) return;
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
    if (!confirm(`Reject device ${pd.mac}?`)) return;
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

  const handleProvision = async () => {
    if (!provisionMac || provisionMac.length !== 17) {
      setProvisionStatus("Invalid MAC (format: AA:BB:CC:DD:EE:FF)");
      return;
    }
    setProvisionStatus("Provisioning...");
    try {
      const response = await apiClient.provisionDevice(provisionMac, provisionFw);
      if (response.status === 201) {
        setProvisionStatus("✓ Device created");
        setProvisionMac("");
        fetchDevices(false);
      } else if (response.status === 409) {
        setProvisionStatus("Device already exists");
      } else {
        const err = await response.json().catch(() => ({}));
        setProvisionStatus(err.message || `Error ${response.status}`);
      }
    } catch (e: any) {
      setProvisionStatus(e.message);
    }
  };

  const handleAttach = async () => {
    if (!attachCode || attachCode.length !== 6) {
      setAttachStatus("Invalid code (6 digits)");
      return;
    }
    setAttachStatus("Attaching...");
    try {
      const userToken = await createTestUserToken();
      const response = await apiClient.attachClaim(attachCode, userToken);
      if (response.ok) {
        setAttachStatus("✓ Code attached");
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
    if (!confirm(`Revoke device ${device.mac}?`)) return;
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
    if (!confirm(`Delete device ${device.mac} permanently?`)) return;
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
    if (!confirm(`Factory reset device ${device.mac}?`)) return;
    try {
      const adminToken = await createTestAdminToken();
      const response = await apiClient.factoryResetAdmin(device.id, adminToken);
      if (response.ok) {
        alert(`Factory reset queued for ${device.mac}`);
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
      setDisplayStatus("Select a device first");
      return;
    }
    setDisplayStatus("Sending...");
    try {
      const instruction: DisplayInstruction = {
        version: 1,
        hash: "",
        symbol: form.symbol,
        symbolFontSize: form.symbolFontSize,
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
        setDisplayStatus("✓ Display updated");
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
      {/* Pending Devices */}
      <div className="bg-amber-50 rounded-md border border-amber-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-amber-900">Pending Devices</h2>
          <button onClick={() => fetchPendingDevices()} className="text-xs px-2 py-1 rounded bg-amber-100 hover:bg-amber-200">
            Refresh
          </button>
        </div>
        {pendingDevices.length === 0 ? (
          <div className="text-xs text-amber-700">No pending devices</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-amber-200">
                <th className="text-left py-2">MAC</th>
                <th className="text-left py-2">Firmware</th>
                <th className="text-left py-2">Last Seen</th>
                <th className="text-left py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingDevices.map((pd) => (
                <tr key={pd.id} className="border-b border-amber-100">
                  <td className="py-2 font-mono whitespace-nowrap">{pd.mac}</td>
                  <td className="py-2">{pd.firmwareVersion || '-'}</td>
                  <td className="py-2">{formatDate(pd.lastSeen)}</td>
                  <td className="py-2 flex gap-2">
                    <button onClick={() => handleApprovePending(pd)} className="text-green-600 hover:text-green-800 font-medium">✓ Approve</button>
                    <button onClick={() => handleRejectPending(pd)} className="text-red-600 hover:text-red-800">Reject</button>
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
          <h2 className="text-sm font-semibold">Devices</h2>
          <button onClick={() => fetchDevices(true)} disabled={loading} className="text-xs px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 disabled:opacity-50">
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-1">MAC</th>
                <th className="text-left py-2 px-1">WiFi</th>
                <th className="text-left py-2 px-1">Status</th>
                <th className="text-left py-2 px-1">Firmware</th>
                <th className="text-left py-2 px-1">Auto-Update</th>
                <th className="text-left py-2 px-1">Demo</th>
                <th className="text-left py-2 px-1">Last Seen</th>
                <th className="text-left py-2 px-1">Battery</th>
                <th className="text-left py-2 px-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && !loading && (
                <tr><td colSpan={9} className="py-4 text-center text-neutral-500">No devices found</td></tr>
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
                      {device.autoUpdate ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td className="py-2 px-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleDemoMode(device); }}
                      className={`px-2 py-0.5 rounded text-[10px] ${device.demoMode ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                    >
                      {device.demoMode ? 'DEMO' : 'OFF'}
                    </button>
                  </td>
                  <td className="py-2 px-1">{formatDate(device.lastSeen)}</td>
                  <td className="py-2 px-1">{device.battery != null ? `${device.battery}%` : "-"}</td>
                  <td className="py-2 px-1 flex gap-2">
                    {device.status === "active" && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); handleRevoke(device); }} className="text-orange-600 hover:text-orange-800">Revoke</button>
                        <button onClick={(e) => { e.stopPropagation(); handleFactoryReset(device); }} className="text-red-600 hover:text-red-800">Reset</button>
                      </>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(device); }} className="text-neutral-500 hover:text-red-600">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Provision Form - collapsible */}
      <details className="bg-white rounded-md border shadow-sm">
        <summary className="px-4 py-2 text-xs text-neutral-500 cursor-pointer hover:text-neutral-700 select-none">Provision New Device</summary>
        <div className="px-4 pb-4 pt-2">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className={labelClass}>MAC Address</label>
              <input type="text" value={provisionMac} onChange={(e) => setProvisionMac(e.target.value.toUpperCase())} placeholder="AA:BB:CC:DD:EE:FF" className={`${inputClass} font-mono`} maxLength={17} />
            </div>
            <div className="w-24">
              <label className={labelClass}>Firmware</label>
              <input type="text" value={provisionFw} onChange={(e) => setProvisionFw(e.target.value)} className={inputClass} />
            </div>
            <button onClick={handleProvision} className="px-3 py-1 bg-neutral-800 text-white text-xs rounded hover:bg-black">Provision</button>
          </div>
          {provisionStatus && <div className="text-[10px] mt-2 text-neutral-600">{provisionStatus}</div>}
        </div>
      </details>

      {/* Attach Form - only for awaiting_claim devices */}
      {selectedDevice && selectedDevice.status === 'awaiting_claim' && (
        <div className="bg-white rounded-md border border-blue-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold mb-3">
            Attach Claim Code <span className="font-normal text-neutral-500">— {selectedDevice.mac}</span>
          </h2>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className={labelClass}>6-Digit Code</label>
              <input type="text" value={attachCode} onChange={(e) => setAttachCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className={`${inputClass} font-mono tracking-widest text-center`} maxLength={6} />
            </div>
            <button onClick={handleAttach} className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Attach</button>
          </div>
          {attachStatus && <div className="text-[10px] mt-2 text-neutral-600">{attachStatus}</div>}
        </div>
      )}

      {/* Display Editor - Only shown when device selected */}
      {selectedDevice && (
        <div className="bg-white rounded-md border p-4 shadow-sm">
          <h2 className="text-sm font-semibold mb-4">
            Display Settings <span className="font-normal text-neutral-500">— {selectedDevice.mac}</span>
          </h2>

          <div className="grid grid-cols-12 gap-3">
            {/* Symbol */}
            <div className="col-span-2">
              <label className={labelClass}>Symbol</label>
              <input value={form.symbol} onChange={(e) => updateForm({ symbol: e.target.value })} className={inputClass} placeholder="BTC" />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Symbol Size</label>
              <select value={form.symbolFontSize} onChange={(e) => updateForm({ symbolFontSize: parseInt(e.target.value) })} className={selectClass}>
                {FONT_SIZE_PRESETS.map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>

            {/* Refresh Interval */}
            <div className="col-span-3">
              <label className={labelClass}>Refresh (sec)</label>
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
              <label className={labelClass}>Timezone</label>
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
              <div className="text-[10px] font-semibold text-neutral-500 mb-2">TOP LINE</div>
            </div>
            
            <div className="col-span-4">
              <label className={labelClass}>Text</label>
              <input 
                value={form.topLine} 
                onChange={(e) => updateForm({ topLine: e.target.value })} 
                className={inputClass} 
                placeholder="Top line text"
                disabled={form.topLineShowDate}
              />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Font Size</label>
              <select value={form.topLineFontSize} onChange={(e) => updateForm({ topLineFontSize: parseInt(e.target.value) })} className={selectClass}>
                {FONT_SIZE_PRESETS.map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Align</label>
              <select value={form.topLineAlign} onChange={(e) => updateForm({ topLineAlign: e.target.value as TextAlign })} className={selectClass}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="col-span-4 flex items-end">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={form.topLineShowDate} onChange={(e) => updateForm({ topLineShowDate: e.target.checked })} className="rounded" />
                Show Date/Time
              </label>
            </div>

            {/* Main Text Section */}
            <div className="col-span-12 border-t pt-3 mt-1">
              <div className="text-[10px] font-semibold text-neutral-500 mb-2">MAIN TEXT</div>
            </div>

            <div className="col-span-6">
              <label className={labelClass}>Text</label>
              <input value={form.mainText} onChange={(e) => updateForm({ mainText: e.target.value })} className={inputClass} placeholder="Main text" />
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Font Size</label>
              <select value={form.mainTextFontSize} onChange={(e) => updateForm({ mainTextFontSize: parseInt(e.target.value) })} className={selectClass}>
                {FONT_SIZE_PRESETS.map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Align</label>
              <select value={form.mainTextAlign} onChange={(e) => updateForm({ mainTextAlign: e.target.value as TextAlign })} className={selectClass}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>

            {/* Bottom Line Section */}
            <div className="col-span-12 border-t pt-3 mt-1">
              <div className="text-[10px] font-semibold text-neutral-500 mb-2">BOTTOM LINE</div>
            </div>

            <div className="col-span-6">
              <label className={labelClass}>Text</label>
              <input value={form.bottomLine} onChange={(e) => updateForm({ bottomLine: e.target.value })} className={inputClass} placeholder="Bottom line text" />
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Font Size</label>
              <select value={form.bottomLineFontSize} onChange={(e) => updateForm({ bottomLineFontSize: parseInt(e.target.value) })} className={selectClass}>
                {FONT_SIZE_PRESETS.map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Align</label>
              <select value={form.bottomLineAlign} onChange={(e) => updateForm({ bottomLineAlign: e.target.value as TextAlign })} className={selectClass}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>

            {/* LED Section */}
            <div className="col-span-12 border-t pt-3 mt-1">
              <div className="text-[10px] font-semibold text-neutral-500 mb-2">LED CONTROL</div>
            </div>

            <div className="col-span-3">
              <label className={labelClass}>Color</label>
              <select value={form.ledColor} onChange={(e) => updateForm({ ledColor: e.target.value as LedColor })} className={selectClass}>
                <option value="green">Green</option>
                <option value="red">Red</option>
                <option value="blue">Blue</option>
                <option value="yellow">Yellow</option>
                <option value="purple">Purple</option>
              </select>
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Brightness</label>
              <select value={form.ledBrightness} onChange={(e) => updateForm({ ledBrightness: e.target.value as LedBrightness })} className={selectClass}>
                <option value="off">Off</option>
                <option value="low">Low</option>
                <option value="mid">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Flash Count</label>
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
                Send Beep
              </label>
            </div>

            {/* Submit */}
            <div className="col-span-12 border-t pt-3 mt-1 flex justify-between items-center">
              <div className="text-[10px] text-neutral-500 flex items-center gap-2">
                {formDirty && <span className="text-amber-600">● Unsaved changes</span>}
                {displayStatus}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={resetForm}
                  disabled={!formDirty}
                  className="px-3 py-2 bg-neutral-200 text-neutral-700 text-xs rounded hover:bg-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reset
                </button>
                <button
                  onClick={handleSetDisplay}
                  disabled={selectedDevice.status !== "active"}
                  className="px-4 py-2 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send to Device
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
