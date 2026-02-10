import React, { useEffect, useState } from "react";
import { DisplayInstruction, FontSize, TextAlign } from "../types/display";

export type ScreenState =
  | "welcome"
  | "wifi_prompt"
  | "claim_requesting"
  | "claim_code"
  | "waiting_for_attach"
  | "secret_received"
  | "heartbeat_active"
  | "error";

interface ScreenProps {
  state: ScreenState;
  claimCode: string | null;
  mac: string;
  wifiOn: boolean;
  deviceId?: string | null;
  deviceSecret?: string | null;
  displayInstruction?: DisplayInstruction | null;
  scale?: number;
  variant?: "flow" | "display";
  battery?: number | null;
}

// Battery icon SVG for low battery warning
const LowBatteryIcon: React.FC = () => (
  <svg width="20" height="10" viewBox="0 0 20 10" fill="currentColor">
    <rect x="0" y="0" width="17" height="10" rx="2" stroke="currentColor" strokeWidth="1" fill="none" />
    <rect x="17" y="3" width="3" height="4" fill="currentColor" />
    <rect x="2" y="2" width="3" height="6" rx="1" fill="currentColor" />
  </svg>
);

// Helper to get font size (handles both legacy string values and new numeric values)
const getFontSize = (size: FontSize | undefined, defaultSize: number): number => {
  if (size === undefined) return defaultSize;
  if (typeof size === 'number') return size;
  // Legacy string values fallback
  if (size === 'small') return 16;
  if (size === 'mid') return 20;
  if (size === 'large') return 35;
  return defaultSize;
};

// Default symbol font size (matches firmware FONT_SIZE_SYMBOL ~24px)
const DEFAULT_SYMBOL_FONT_SIZE = 24;

// Layout constants (matches firmware RECT_WIDTH = 135)
const SYMBOL_BAR_WIDTH = 135;
const RIGHT_AREA_WIDTH = 249; // 384 - 135

// Text alignment mapping
const textAlignMap: Record<TextAlign, React.CSSProperties['textAlign']> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

export const Screen: React.FC<ScreenProps> = ({
  state,
  claimCode,
  wifiOn,
  deviceId,
  deviceSecret,
  displayInstruction,
  scale = 2,
  variant = "flow",
  battery,
}) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  let content: React.ReactNode = null;
  
  switch (state) {
    case "welcome":
      content = (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <div className="text-[13px] font-semibold tracking-wide">ПРИВЕТ</div>
          <div className="text-[10px] opacity-70 max-w-[260px] leading-tight">
            TigerMeter запускается…
          </div>
        </div>
      );
      break;
      
    case "wifi_prompt":
      content = (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <div className="text-[12px] font-semibold tracking-wide">
            ПОДКЛЮЧИТЕСЬ К WIFI
          </div>
          <div className="text-[10px] opacity-70 max-w-[280px] leading-tight">
            {wifiOn
              ? "WiFi подключён. Укажите MAC и добавьте устройство, чтобы начать привязку."
              : "Включите WiFi (переключатель вверху), чтобы продолжить."}
          </div>
        </div>
      );
      break;
      
    case "claim_requesting":
      content = (
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 animate-pulse">
          <div className="text-[11px] font-semibold tracking-wide">
            ЗАПРОС КОДА ПРИВЯЗКИ…
          </div>
          <div className="text-[10px] opacity-60">Связь с сервером</div>
        </div>
      );
      break;
      
    case "claim_code":
      content = (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <div className="text-[11px] font-semibold tracking-wide">
            КОД ПРИВЯЗКИ
          </div>
          <div className="text-[30px] font-bold tracking-widest tabular-nums">
            {claimCode}
          </div>
          <div className="text-[9px] opacity-60 max-w-[260px] leading-tight">
            Используйте этот код в портале для привязки устройства.
          </div>
        </div>
      );
      break;
      
    case "waiting_for_attach":
      content = (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <div className="text-[11px] font-semibold tracking-wide">
            ОЖИДАНИЕ ПРИВЯЗКИ
          </div>
          <div className="text-[20px] font-bold tracking-widest tabular-nums animate-pulse">
            {claimCode}
          </div>
          <div className="text-[9px] opacity-60 max-w-[260px] leading-tight">
            Код выдан. Опрос портала на предмет привязки пользователя…
          </div>
        </div>
      );
      break;
      
    case "secret_received":
      content = (
        <div className="flex flex-col items-center justify-center h-full text-center gap-2">
          <div className="text-[10px] font-semibold tracking-wide">
            УСТРОЙСТВО ГОТОВО
          </div>
          <div className="text-[8px] opacity-70 mb-1">ID: {deviceId}</div>
          <div className="text-[7px] font-mono bg-gray-100 px-2 py-1 rounded max-w-[350px] break-all">
            {deviceSecret}
          </div>
          <div className="text-[8px] opacity-60 mt-1">
            Секрет получен. Устройство активно.
          </div>
        </div>
      );
      break;
      
    case "heartbeat_active":
      if (displayInstruction?.symbol) {
        const s = displayInstruction;
        const locale = "ru-RU";
        
        // Format current date/time for topLineShowDate (using configured timezone)
        // Render text with \n support (literal backslash-n from JSON)
        const renderMultiline = (text: string) => {
          const parts = text.split('\\n');
          if (parts.length === 1) return text;
          return parts.map((line, i) => (
            <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
          ));
        };

        const formatDateTime = () => {
          // Calculate time in the configured timezone
          const tzOffset = s.timezoneOffset ?? 3; // Default Moscow UTC+3
          const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
          const tzTime = new Date(utcTime + tzOffset * 3600000);
          
          const timeStr = new Intl.DateTimeFormat(locale, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }).format(tzTime);
          const dateStr = new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "short",
          }).format(tzTime);
          return `${timeStr} ${dateStr}`;
        };
        
        // Get font sizes (using numeric values directly, with fallback for legacy strings)
        const topFontSize = getFontSize(s.topLineFontSize, 16);
        const mainFontSize = getFontSize(s.mainTextFontSize, 32);
        const bottomFontSize = getFontSize(s.bottomLineFontSize, 16);
        
        // Get alignments
        const topAlign = textAlignMap[s.topLineAlign || 'center'];
        const mainAlign = textAlignMap[s.mainTextAlign || 'center'];
        const bottomAlign = textAlignMap[s.bottomLineAlign || 'center'];
        
        // What to show in top line
        const topLineContent = s.topLineShowDate ? formatDateTime() : (s.topLine || '');
        
        if (variant === "display") {
          // Full display layout with symbol bar
          content = (
            <div
              className="absolute inset-0 flex"
            >
              {/* Left symbol bar */}
              <div
                style={{
                  width: SYMBOL_BAR_WIDTH,
                  height: 168,
                  background: "#121212",
                  color: "#fafafa",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                }}
              >
                <div className="font-bold tracking-tight" style={{ fontSize: getFontSize(s.symbolFontSize, DEFAULT_SYMBOL_FONT_SIZE) }}>
                  {s.symbol}
                </div>
              </div>
              
              {/* Right content area */}
              <div
                className="flex flex-col justify-between"
                style={{ width: RIGHT_AREA_WIDTH, padding: "8px 10px" }}
              >
                {/* Top line */}
                <div
                  className="leading-tight"
                  style={{ 
                    fontSize: topFontSize, 
                    textAlign: topAlign,
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    fontWeight: 500,
                  }}
                >
                  {topLineContent}
                </div>
                
                {/* Main text - centered vertically */}
                <div
                  className="flex-1 flex items-center"
                  style={{ justifyContent: mainAlign === 'center' ? 'center' : mainAlign === 'right' ? 'flex-end' : 'flex-start' }}
                >
                  <div
                    className="leading-none tracking-tight"
                    style={{ 
                      fontSize: mainFontSize, 
                      textAlign: mainAlign,
                      fontFamily: "system-ui, -apple-system, sans-serif",
                      fontWeight: 700,
                    }}
                  >
                    {renderMultiline(s.mainText)}
                  </div>
                </div>
                
                {/* Bottom line */}
                <div
                  className="leading-tight"
                  style={{ 
                    fontSize: bottomFontSize, 
                    textAlign: bottomAlign,
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    fontWeight: 500,
                  }}
                >
                  {s.bottomLine || ''}
                </div>
              </div>
            </div>
          );
        } else {
          // Simple flow variant
          content = (
            <div className="flex flex-col h-full p-4">
              {/* Top line */}
              <div
                className="font-medium"
                style={{ fontSize: topFontSize, textAlign: topAlign }}
              >
                {topLineContent || <span className="opacity-30">—</span>}
              </div>
              
              {/* Main area with symbol and main text */}
              <div className="flex-1 flex items-center justify-center gap-3">
                <div className="text-[16px] font-bold opacity-60">{s.symbol}</div>
                <div
                  className="font-black"
                  style={{ fontSize: mainFontSize, textAlign: mainAlign }}
                >
                  {renderMultiline(s.mainText)}
                </div>
              </div>
              
              {/* Bottom line */}
              <div
                className="font-medium"
                style={{ fontSize: bottomFontSize, textAlign: bottomAlign }}
              >
                {s.bottomLine || <span className="opacity-30">—</span>}
              </div>
            </div>
          );
        }
      } else {
        content = (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2">
            <div className="text-[11px] font-semibold tracking-wide">
              УСТРОЙСТВО АКТИВНО
            </div>
            <div className="text-[10px] opacity-70">
              Нет инструкции отображения
            </div>
          </div>
        );
      }
      break;
      
    case "error":
      content = (
        <div className="flex flex-col items-center justify-center h-full text-center gap-2">
          <div className="text-[12px] font-semibold tracking-wide text-red-700">
            ОШИБКА
          </div>
          <div className="text-[10px] opacity-70">
            Проверьте панель логов для деталей
          </div>
        </div>
      );
      break;
  }

  return (
    <div className="relative inline-block">
      <div
        className="epaper-screen-scaled"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <div style={{ display: "flex" }}>
          <div
            className="screen epaper-screen shadow-insetThin bg-epaperBg text-epaperInk font-mono overflow-hidden relative"
            style={{
              width: 384,
              height: 168,
              lineHeight: "1.1",
              fontSize: 12,
              fontFamily:
                'ui-monospace, "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
            }}
          >
            {content}
            {variant !== "display" && (
              <div className="absolute bottom-1 right-2 text-[9px] opacity-40 tabular-nums">
                {now.toLocaleTimeString()}
              </div>
            )}
            {/* Low battery indicator */}
            {battery !== undefined && battery !== null && battery < 10 && (
              <div className="absolute top-2 left-2 opacity-80">
                <LowBatteryIcon />
              </div>
            )}
          </div>
          
          {/* LED bar */}
          {(() => {
            let ledColor: string | undefined;
            let ledBrightness: string | undefined;
            let flashCount: number | undefined;
            
            if (displayInstruction) {
              ledColor = displayInstruction.ledColor;
              ledBrightness = displayInstruction.ledBrightness;
              flashCount = displayInstruction.flashCount;
            }
            
            const colorMap: Record<string, string> = {
              red: "#dc2626",
              green: "#16a34a",
              blue: "#2563eb",
              yellow: "#ca8a04",
              purple: "#7e22ce",
            };
            
            const brightnessOpacity: Record<string, number> = {
              off: 0.15,
              low: 0.35,
              mid: 0.65,
              high: 1,
            };
            
            const active = ledColor && ledBrightness && ledBrightness !== "off";
            const flash = active && flashCount && flashCount > 0;
            
            return (
              <div
                className={`ml-1 h-[168px] rounded-sm border border-neutral-400 relative overflow-hidden ${flash ? "led-flash" : ""}`}
                style={{
                  width: 38,
                  background: active ? colorMap[ledColor!] : "#d4d4d4",
                  opacity: active ? brightnessOpacity[ledBrightness!] : 0.3,
                  boxShadow: active
                    ? "0 0 6px 1px rgba(0,0,0,0.25) inset"
                    : "inset 0 0 0 1px rgba(0,0,0,0.15)",
                  animation: flash
                    ? `ledFlashGrey 0.6s ${flashCount} alternate`
                    : undefined,
                }}
              >
                <div
                  className="absolute inset-0 mix-blend-overlay opacity-30"
                  style={{
                    background:
                      "repeating-linear-gradient(0deg, rgba(255,255,255,0.18) 0, rgba(255,255,255,0.18) 2px, transparent 2px, transparent 4px)",
                  }}
                />
              </div>
            );
          })()}
        </div>
      </div>
      
      <div
        className="absolute text-[11px] font-mono opacity-60"
        style={{ top: 168 * scale + 8, left: 0 }}
      >
        384x168 + LED {scale > 1 ? `(${scale}x)` : ""} • 67.58×29.57 mm
      </div>
    </div>
  );
};
