import React, { useEffect, useState } from "react";
import { Screen, ScreenState } from "./components/Screen";
import { DisplayEditor } from "./components/DisplayEditor";
import { MacInput } from "./components/MacInput";
import { WifiToggle } from "./components/WifiToggle";
import { apiClient } from "./api/client";
import { LogPanel } from "./components/LogPanel";
import { DisplayInstruction } from "./types/display";
import { createTestUserToken } from "./utils/jwt";

export const App: React.FC = () => {
  const [mode, setMode] = useState<"flow" | "display">("flow");
  const [mac, setMac] = useState("");
  const [wifiOn, setWifiOn] = useState(false);
  const [screenState, setScreenState] = useState<ScreenState>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [claimCode, setClaimCode] = useState<string | null>(null);
  const [claimExpiresAt, setClaimExpiresAt] = useState<string | null>(null);
  const [provisionStatus, setProvisionStatus] = useState<string>("");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceSecret, setDeviceSecret] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<number | null>(null);
  const [displayInstruction, setDisplayInstruction] =
    useState<DisplayInstruction | null>(null);
  const [displayHash, setDisplayHash] = useState<string>("");
  const [heartbeatInterval, setHeartbeatInterval] = useState<number | null>(
    null
  );
  const [uptimeStart, setUptimeStart] = useState<number>(Date.now());
  const firmware = "dev-firmware";

  // Timed transition: welcome -> wifi_prompt after 5s
  useEffect(() => {
    if (screenState !== "welcome") return;
    const t = setTimeout(() => setScreenState("wifi_prompt"), 5000);
    return () => clearTimeout(t);
  }, [screenState]);

  // WiFi state change: when disabled, go back to wifi_prompt (unless in welcome or error)
  useEffect(() => {
    if (!wifiOn && screenState !== "welcome" && screenState !== "error") {
      setScreenState("wifi_prompt");
      setError(null);
      setClaimCode(null);
      setClaimExpiresAt(null);
      setDeviceId(null);
      setDeviceSecret(null);
      setDisplayInstruction(null);
      setDisplayHash("");
      // Clear intervals
      if (pollingInterval) {
        clearInterval(pollingInterval);
        setPollingInterval(null);
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        setHeartbeatInterval(null);
      }
    }
  }, [wifiOn, screenState, pollingInterval, heartbeatInterval]);

  // Polling function with exponential backoff
  const startPolling = (code: string) => {
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes with exponential backoff

    const poll = async () => {
      try {
        const response = await apiClient.pollClaimCode(code);

        if (response.status === 200) {
          // Success - got the secret
          const data = await response.json();
          setDeviceId(data.deviceId);
          setDeviceSecret(data.deviceSecret);
          setDisplayHash(data.displayHash || "");
          setScreenState("secret_received");
          // Auto-transition to heartbeat after showing secret briefly
          setTimeout(() => {
            setScreenState("heartbeat_active");
            setUptimeStart(Date.now());
            if (data.deviceId && data.deviceSecret) {
              startHeartbeat(data.deviceId, data.deviceSecret);
            }
          }, 5000);
          if (pollingInterval) clearInterval(pollingInterval);
          return;
        } else if (response.status === 202) {
          // Still waiting - continue polling
          attempts++;
          if (attempts >= maxAttempts) {
            setError("Polling timeout - claim may have expired");
            setScreenState("error");
            if (pollingInterval) clearInterval(pollingInterval);
            return;
          }
          // Exponential backoff: 2s, 4s, 8s, 16s, max 30s
          const delay = Math.min(
            2000 * Math.pow(2, Math.floor(attempts / 3)),
            30000
          );
          setTimeout(poll, delay);
        } else if (response.status === 404) {
          setError("Claim code not found or already consumed");
          setScreenState("error");
          if (pollingInterval) clearInterval(pollingInterval);
        } else if (response.status === 410) {
          setError("Claim code expired");
          setScreenState("error");
          if (pollingInterval) clearInterval(pollingInterval);
        } else {
          setError(`Polling failed: ${response.status}`);
          setScreenState("error");
          if (pollingInterval) clearInterval(pollingInterval);
        }
      } catch (e: any) {
        setError(`Polling error: ${e.message}`);
        setScreenState("error");
        if (pollingInterval) clearInterval(pollingInterval);
      }
    };

    // Start immediate first poll
    poll();
  };

  // Heartbeat function that sends device status and checks for display updates
  const startHeartbeat = (deviceId: string, deviceSecret: string) => {
    const sendHeartbeat = async () => {
      try {
        const uptimeSeconds = Math.floor((Date.now() - uptimeStart) / 1000);
        const heartbeatData = {
          battery: Math.floor(80 + Math.random() * 20), // Mock battery 80-100%
          rssi: Math.floor(-70 + Math.random() * 40), // Mock RSSI -70 to -30
          ip: "192.168.1.100", // Mock IP
          firmwareVersion: firmware,
          uptimeSeconds,
          displayHash,
        };

        const response = await apiClient.sendHeartbeat(
          deviceId,
          deviceSecret,
          heartbeatData
        );

        if (response.status === 200) {
          const data = await response.json();
          if (data.instruction) {
            // Got new display instruction
            setDisplayInstruction(data.instruction);
            setDisplayHash(data.displayHash || data.instruction.hash);
          }
          // else: data.ok === true, no changes
        } else {
          console.warn("Heartbeat failed:", response.status);
        }
      } catch (e: any) {
        console.warn("Heartbeat error:", e.message);
      }
    };

    // Send first heartbeat immediately
    sendHeartbeat();
    // Then every 30 seconds
    const interval = setInterval(sendHeartbeat, 30000);
    setHeartbeatInterval(interval);
  };

  // When wifi enabled & MAC present in wifi_prompt, request claim (one-shot)
  useEffect(() => {
    if (screenState === "wifi_prompt" && wifiOn && mac.length === 17) {
      setScreenState("claim_requesting");
      apiClient
        .issueClaim(mac)
        .then(async (r) => {
          if (!r.ok) {
            setError(`Claim failed (${r.status})`);
            setScreenState("error");
            return;
          }
          const data = await r.json().catch(() => ({}));
          if (data.code) {
            setClaimCode(data.code);
            setClaimExpiresAt(data.expiresAt || null);
            // Start with claim_code screen, then transition to polling
            setScreenState("claim_code");
            // Auto-transition to polling after showing code briefly
            setTimeout(() => {
              if (data.code) {
                setScreenState("waiting_for_attach");
                startPolling(data.code);
              }
            }, 3000);
          } else {
            setError("Malformed claim response");
            setScreenState("error");
          }
        })
        .catch((e) => {
          setError(e.message);
          setScreenState("error");
        });
    }
  }, [screenState, wifiOn, mac]);

  useEffect(() => {
    let abort = false;
    if (wifiOn && mac.length === 17) {
      // Claim request handled by separate effect when in wifi_prompt state.
    }
    return () => {
      abort = true;
    };
  }, [wifiOn, mac]);

  const [displayModeInstruction, setDisplayModeInstruction] =
    useState<DisplayInstruction | null>(null);
  const [screenScale, setScreenScale] = useState(2);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white/70 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">
            TigerMeter Web Emulator
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-neutral-100 rounded px-1 py-0.5 border">
              <button
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  mode === "flow"
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
                onClick={() => setMode("flow")}
              >
                Flow
              </button>
              <button
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  mode === "display"
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
                onClick={() => setMode("display")}
              >
                Display
              </button>
            </div>
            {/* WiFi toggle moved into flow panel */}
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-6 flex flex-col gap-8 md:flex-row">
        {mode === "flow" && (
          <div className="w-80 flex-shrink-0 flex flex-col gap-6 order-2 md:order-1">
            <section className="bg-white rounded-md border p-4 flex flex-col gap-4 shadow-sm">
              <div className="flex items-center justify-between">
                <MacInput value={mac} onChange={setMac} disabled={wifiOn} />
                <div className="flex flex-col items-end gap-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide">
                    WiFi
                  </div>
                  <WifiToggle value={wifiOn} onChange={setWifiOn} />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs font-medium">
                  Provision Device (dev)
                </div>
                <div className="text-[10px] text-neutral-500">
                  Firmware: {firmware}
                </div>
                <button
                  type="button"
                  disabled={
                    mac.length !== 17 || provisionStatus === "provisioning"
                  }
                  onClick={async () => {
                    setProvisionStatus("provisioning");
                    try {
                      const r = await apiClient.provisionDevice(mac, firmware);
                      if (r.status === 201) {
                        setProvisionStatus("created");
                      } else if (r.status === 409) {
                        setProvisionStatus("exists");
                      } else if (r.status === 400) {
                        setProvisionStatus("invalid");
                      } else {
                        setProvisionStatus("err:" + r.status);
                      }
                    } catch (e: any) {
                      setProvisionStatus("error");
                    }
                  }}
                  className="inline-flex items-center justify-center bg-neutral-800 text-white text-xs px-3 py-1 rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-black transition-colors"
                >
                  Provision
                </button>
                {provisionStatus && (
                  <div className="text-[10px] text-neutral-600">
                    {provisionStatus}
                  </div>
                )}
              </div>
              {claimCode && screenState === "waiting_for_attach" && (
                <div className="flex flex-col gap-1 border-t pt-3">
                  <div className="text-xs font-medium">
                    Portal Simulation (dev)
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    Auto-attach claim code for testing
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        // Create a test JWT token for portal simulation
                        const testToken = await createTestUserToken(
                          "test-emulator-user-123"
                        );

                        // Use the API client with proper JWT
                        const response = await apiClient.attachClaim(
                          claimCode,
                          testToken
                        );

                        if (response.ok) {
                          console.log("Portal attach simulation successful");
                          // Attachment successful, polling should detect this shortly
                        } else {
                          const errorData = await response
                            .json()
                            .catch(() => null);
                          console.warn(
                            "Portal attach simulation failed:",
                            response.status,
                            errorData
                          );
                        }
                      } catch (e) {
                        console.warn("Portal attach simulation error:", e);
                      }
                    }}
                    className="inline-flex items-center justify-center bg-blue-800 text-white text-xs px-3 py-1 rounded hover:bg-blue-900 transition-colors"
                  >
                    Simulate Portal Attach
                  </button>
                  <div className="text-[10px] text-neutral-500">
                    Uses test JWT token for authentication
                  </div>
                </div>
              )}
              {screenState === "heartbeat_active" && (
                <div className="flex flex-col gap-1 border-t pt-3">
                  <div className="text-xs font-medium">Display Test (dev)</div>
                  <div className="text-[10px] text-neutral-500">
                    Mock display instructions for testing
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const mockInstruction: DisplayInstruction = {
                          type: "single",
                          version: 1,
                          hash: "mock-hash-1",
                          single: {
                            name: "BTC/USD",
                            price: 45250.5,
                            currencySymbol: "$",
                            timestamp: new Date().toISOString(),
                            ledColor: "green",
                            ledBrightness: "high",
                            portfolioValue: 125000,
                            portfolioChangePercent: 2.5,
                          },
                        };
                        setDisplayInstruction(mockInstruction);
                        setDisplayHash(mockInstruction.hash);
                      }}
                      className="inline-flex items-center justify-center bg-green-800 text-white text-[10px] px-2 py-1 rounded hover:bg-green-900 transition-colors"
                    >
                      BTC Up
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const mockInstruction: DisplayInstruction = {
                          type: "single",
                          version: 2,
                          hash: "mock-hash-2",
                          single: {
                            name: "ETH/USD",
                            price: 2850.25,
                            currencySymbol: "$",
                            timestamp: new Date().toISOString(),
                            ledColor: "red",
                            ledBrightness: "mid",
                            portfolioValue: 118500,
                            portfolioChangePercent: -1.8,
                          },
                        };
                        setDisplayInstruction(mockInstruction);
                        setDisplayHash(mockInstruction.hash);
                      }}
                      className="inline-flex items-center justify-center bg-red-800 text-white text-[10px] px-2 py-1 rounded hover:bg-red-900 transition-colors"
                    >
                      ETH Down
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDisplayInstruction(null);
                        setDisplayHash("empty");
                      }}
                      className="inline-flex items-center justify-center bg-gray-600 text-white text-[10px] px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
              <div className="text-xs text-neutral-600 leading-relaxed">
                <p>
                  Enter a MAC, provision the device, then enable WiFi (toggle in
                  header) to start claim flow.
                </p>
                <p className="mt-1">
                  Next steps: poll, secret issuance, heartbeat, display
                  rendering.
                </p>
              </div>
              <div className="text-xs font-mono space-y-1">
                <div>
                  Screen: <span className="font-semibold">{screenState}</span>
                </div>
                {claimCode && (
                  <div>
                    Code:{" "}
                    <span className="font-semibold tracking-widest">
                      {claimCode}
                    </span>
                    {claimExpiresAt && (
                      <span className="ml-1 text-neutral-500">
                        exp {new Date(claimExpiresAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                )}
                {deviceId && (
                  <div>
                    Device ID: <span className="font-semibold">{deviceId}</span>
                  </div>
                )}
                {deviceSecret && (
                  <div className="break-all">
                    Secret:{" "}
                    <span className="font-mono text-[10px]">
                      {deviceSecret.substring(0, 20)}...
                    </span>
                  </div>
                )}
                {error && <div className="text-red-600">{error}</div>}
              </div>
            </section>
            <section className="bg-white rounded-md border p-4 shadow-sm">
              <h2 className="text-sm font-semibold mb-2">Roadmap</h2>
              <ol className="list-decimal list-inside text-xs space-y-1 text-neutral-700">
                <li>Poll + lazy secret issuance</li>
                <li>Persist emulator state (localStorage)</li>
                <li>Heartbeat loop + display hash compare</li>
                <li>Render instruction (single/playlist)</li>
                <li>Secret refresh + revoke handling</li>
                <li>Network conditions simulation (latency, offline)</li>
              </ol>
            </section>
          </div>
        )}
        {mode === "display" && (
          <div className="w-80 flex-shrink-0 flex flex-col gap-6 order-2 md:order-1">
            <section className="bg-white rounded-md border p-4 flex flex-col gap-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Display Editor</h2>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-medium">Scale</label>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    value={screenScale}
                    onChange={(e) => setScreenScale(parseInt(e.target.value))}
                  />
                  <div className="text-[10px] w-6 text-right">
                    {screenScale}x
                  </div>
                </div>
              </div>
              <DisplayEditor
                value={displayModeInstruction}
                onChange={setDisplayModeInstruction}
                onClear={() => setDisplayModeInstruction(null)}
              />
            </section>
            <section className="bg-white rounded-md border p-4 shadow-sm text-[11px] text-neutral-600">
              <div>
                Mode: Live single-instruction editing. Playlist coming later.
              </div>
            </section>
          </div>
        )}
        <div className="flex flex-col items-start md:items-center justify-start gap-4 order-1 md:order-2">
          {/** total width: display 384 + led 8 + margin 4 */}
          <div
            className="inline-block"
            style={{
              width: (384 + 8 + 4) * (mode === "display" ? screenScale : 2),
              height: 168 * (mode === "display" ? screenScale : 2) + 40,
            }}
          >
            <Screen
              state={mode === "flow" ? screenState : "heartbeat_active"}
              claimCode={claimCode}
              mac={mac}
              wifiOn={wifiOn}
              deviceId={deviceId}
              deviceSecret={deviceSecret}
              displayInstruction={
                mode === "flow" ? displayInstruction : displayModeInstruction
              }
              scale={mode === "display" ? screenScale : 2}
              variant={mode === "display" ? "display" : "flow"}
            />
          </div>
          <div
            style={{
              width: (384 + 8 + 4) * (mode === "display" ? screenScale : 2),
            }}
          >
            <LogPanel />
          </div>
        </div>
      </main>
      <footer className="text-center text-[11px] text-neutral-500 py-4">
        © {new Date().getFullYear()} TigerMeter Emulator
      </footer>
    </div>
  );
};
