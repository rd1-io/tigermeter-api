import React, { useCallback } from "react";

interface MacInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const normalizeMac = (raw: string) => {
  const hex = raw
    .replace(/[^a-fA-F0-9]/g, "")
    .toUpperCase()
    .slice(0, 12);
  const pairs: string[] = [];
  for (let i = 0; i < hex.length; i += 2) pairs.push(hex.slice(i, i + 2));
  return pairs.join(":");
};

export const MacInput: React.FC<MacInputProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(normalizeMac(e.target.value));
    },
    [onChange]
  );

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" htmlFor="mac">
        MAC Address
      </label>
      <input
        id="mac"
        placeholder="AA:BB:CC:DD:EE:FF"
        className="border rounded px-2 py-1 text-sm font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        maxLength={17}
      />
    </div>
  );
};
