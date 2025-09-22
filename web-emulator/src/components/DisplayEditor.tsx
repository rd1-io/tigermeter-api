import React, { useEffect, useState } from "react";
import { DisplayInstruction, DisplaySingle } from "../types/display";

interface DisplayEditorProps {
  value: DisplayInstruction | null;
  onChange: (next: DisplayInstruction) => void;
  onClear: () => void;
}

const defaultSingle: DisplaySingle = {
  name: "BTC/USD",
  price: 45000,
  currencySymbol: "$",
  timestamp: new Date().toISOString(),
  ledColor: "green",
  ledBrightness: "high",
  portfolioValue: 100000,
  portfolioChangePercent: 2.3,
};

export const DisplayEditor: React.FC<DisplayEditorProps> = ({
  value,
  onChange,
  onClear,
}) => {
  const [single, setSingle] = useState<DisplaySingle>(() => {
    try {
      const raw = localStorage.getItem("tm.displayEditor.single");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.name &&
          parsed.price !== undefined
        ) {
          return { ...defaultSingle, ...parsed } as DisplaySingle;
        }
      }
    } catch {}
    return value?.type === "single" ? value.single : defaultSingle;
  });

  // Update timestamp live if unchanged manually
  useEffect(() => {
    const t = setInterval(() => {
      setSingle((s) => ({ ...s, timestamp: new Date().toISOString() }));
    }, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const instruction: DisplayInstruction = {
      type: "single",
      version: 1,
      hash: "editor-" + JSON.stringify(single).length + "-" + Date.now(),
      single,
    };
    try {
      localStorage.setItem("tm.displayEditor.single", JSON.stringify(single));
    } catch {}
    onChange(instruction);
  }, [single, onChange]);

  const update = <K extends keyof DisplaySingle>(
    key: K,
    value: DisplaySingle[K]
  ) => {
    setSingle((s) => ({ ...s, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[10px] font-medium mb-1">Name</label>
          <input
            value={single.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full border px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="w-24">
          <label className="block text-[10px] font-medium mb-1">Price</label>
          <input
            type="number"
            value={single.price}
            onChange={(e) => update("price", parseFloat(e.target.value) || 0)}
            className="w-full border px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="w-20">
          <label className="block text-[10px] font-medium mb-1">Currency</label>
          <input
            value={single.currencySymbol}
            onChange={(e) => update("currencySymbol", e.target.value)}
            className="w-full border px-2 py-1 rounded text-xs"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="w-28">
          <label className="block text-[10px] font-medium mb-1">
            Portfolio
          </label>
          <input
            type="number"
            value={single.portfolioValue ?? ""}
            onChange={(e) =>
              update(
                "portfolioValue",
                e.target.value === "" ? undefined : parseFloat(e.target.value)
              )
            }
            className="w-full border px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="w-28">
          <label className="block text-[10px] font-medium mb-1">Change %</label>
          <input
            type="number"
            value={single.portfolioChangePercent ?? ""}
            onChange={(e) =>
              update(
                "portfolioChangePercent",
                e.target.value === "" ? undefined : parseFloat(e.target.value)
              )
            }
            className="w-full border px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="w-28">
          <label className="block text-[10px] font-medium mb-1">
            Change Abs
          </label>
          <input
            type="number"
            value={single.portfolioChangeAbsolute ?? ""}
            onChange={(e) =>
              update(
                "portfolioChangeAbsolute",
                e.target.value === "" ? undefined : parseFloat(e.target.value)
              )
            }
            className="w-full border px-2 py-1 rounded text-xs"
          />
        </div>
      </div>
      <div className="flex gap-2 items-end">
        <div className="w-32">
          <label className="block text-[10px] font-medium mb-1">
            LED Color
          </label>
          <select
            value={single.ledColor}
            onChange={(e) => update("ledColor", e.target.value as any)}
            className="w-full border px-2 py-1 rounded text-xs"
          >
            <option value="blue">Blue</option>
            <option value="green">Green</option>
            <option value="red">Red</option>
            <option value="yellow">Yellow</option>
            <option value="purple">Purple</option>
          </select>
        </div>
        <div className="w-32">
          <label className="block text-[10px] font-medium mb-1">
            LED Brightness
          </label>
          <select
            value={single.ledBrightness}
            onChange={(e) => update("ledBrightness", e.target.value as any)}
            className="w-full border px-2 py-1 rounded text-xs"
          >
            <option value="off">Off</option>
            <option value="low">Low</option>
            <option value="mid">Mid</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="w-24">
          <label className="block text-[10px] font-medium mb-1">Flash</label>
          <input
            type="number"
            value={single.flashCount ?? ""}
            onChange={(e) =>
              update(
                "flashCount",
                e.target.value === ""
                  ? undefined
                  : parseInt(e.target.value) || 0
              )
            }
            className="w-full border px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="flex-1 flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => {
              setSingle(defaultSingle);
            }}
            className="text-xs px-2 py-1 rounded bg-neutral-200 hover:bg-neutral-300"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => {
              onClear();
              try {
                localStorage.removeItem("tm.displayEditor.single");
              } catch {}
              setSingle(defaultSingle);
            }}
            className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="text-[10px] text-neutral-500">
        Instruction hash updates automatically as you edit.
      </div>
    </div>
  );
};
