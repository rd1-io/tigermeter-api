import React from "react";

interface WifiToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export const WifiToggle: React.FC<WifiToggleProps> = ({
  value,
  onChange,
  disabled,
}) => {
  return (
    <div className="flex flex-col gap-1 select-none">
      <span className="text-xs font-medium">WiFi</span>
      <button
        type="button"
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className={`relative inline-flex items-center h-7 w-14 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          value ? "bg-green-500" : "bg-neutral-400"
        } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`inline-block h-6 w-6 rounded-full bg-white shadow transform transition-transform ${
            value ? "translate-x-7" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
};
