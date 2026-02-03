import React, { useState } from "react";
import { AdminPanel, Device } from "./components/AdminPanel";
import { LogPanel } from "./components/LogPanel";
import { Screen } from "./components/Screen";
import { DisplayInstruction } from "./types/display";

const LEFT_COLUMN_WIDTH = "flex-1";
const RIGHT_COLUMN_WIDTH = "w-[480px]";

export const App: React.FC = () => {
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [previewInstruction, setPreviewInstruction] = useState<DisplayInstruction | null>(null);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white/70 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">
            TigerMeter Web Emulator
          </h1>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-6 py-6 flex flex-col gap-6 md:flex-row">
        {/* Left column - Admin Panel */}
        <div className={`${LEFT_COLUMN_WIDTH} flex flex-col gap-6 order-2 md:order-1`}>
          <AdminPanel
            selectedDevice={selectedDevice}
            onSelectDevice={setSelectedDevice}
            onPreviewChange={setPreviewInstruction}
          />
        </div>

        {/* Right column - Logs + Display Preview */}
        <div className={`${RIGHT_COLUMN_WIDTH} flex-shrink-0 flex flex-col gap-4 order-1 md:order-2`}>
          <LogPanel />

          {/* Device Screen Preview */}
          {selectedDevice && (
            <div className="bg-white rounded-md border p-4 shadow-sm">
              <h2 className="text-sm font-semibold mb-3">
                Display Preview — {selectedDevice.mac}
              </h2>
              <div className="flex justify-center overflow-x-auto">
                <div
                  style={{
                    width: 384 + 38 + 4,
                    height: 168 + 40,
                  }}
                >
                  <Screen
                    state="heartbeat_active"
                    claimCode={null}
                    mac={selectedDevice.mac}
                    wifiOn={true}
                    deviceId={selectedDevice.id}
                    displayInstruction={previewInstruction}
                    scale={1}
                    variant="display"
                    battery={selectedDevice.battery}
                  />
                </div>
              </div>
              {!previewInstruction && (
                <div className="text-center text-xs text-neutral-500 mt-2">
                  No display instruction set for this device
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      <footer className="text-center text-[11px] text-neutral-500 py-4">
        © {new Date().getFullYear()} TigerMeter Emulator
      </footer>
    </div>
  );
};
