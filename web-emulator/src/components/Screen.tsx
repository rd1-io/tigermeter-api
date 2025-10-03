import React, { useEffect, useState } from "react";
import { DisplayInstruction } from "../types/display";

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
}

export const Screen: React.FC<ScreenProps> = ({
  state,
  claimCode,
  wifiOn,
  deviceId,
  deviceSecret,
  displayInstruction,
  scale = 2, // Default 2x scale for better visibility
  variant = "flow",
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
            Используйте этот код в портале для привязки устройства. Скоро
            истечёт.
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
      if (displayInstruction?.type === "single") {
        const single = displayInstruction.single;
        if (variant === "display") {
          const dt = new Date(single.timestamp);
          const locale = "ru-RU";
          const dateStrRaw = new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "long",
          }).format(dt);
          const [dayPart, monthPart] = dateStrRaw.split(" ");
          const monthCap = monthPart
            ? monthPart.charAt(0).toUpperCase() + monthPart.slice(1)
            : "";
          const dateStr = `${dayPart || ""} ${monthCap}`.trim();
          const timeStr = new Intl.DateTimeFormat(locale, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(dt);
          const dateTimeStr = `${dateStr}, ${timeStr}`;
          const asset = single.name.split("/")[0].toUpperCase();
          // Dynamic price formatting
          const rawPrice = single.price;
          const decimals = rawPrice >= 1 ? 2 : 4;
          let formatted = rawPrice.toFixed(decimals);
          if (decimals > 0) {
            formatted = formatted
              .replace(/\.0+$/, "")
              .replace(/(\.[0-9]*?)0+$/, "$1");
          }
          const priceStr = `${single.currencySymbol}${formatted}`;
          // Adaptive font sizing thresholds based on character length
          const priceFontSizeOverride = single.extensions?.priceFontSize as
            | number
            | undefined;
          let priceFontSize = priceFontSizeOverride ?? 42; // base
          if (priceStr.length > 10) priceFontSize = 38;
          if (priceStr.length > 12) priceFontSize = 34;
          if (priceStr.length > 14) priceFontSize = 30;
          if (priceFontSizeOverride !== undefined) {
            priceFontSize = priceFontSizeOverride;
          }
          content = (
            <div
              className="absolute inset-0 flex"
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {/* Left square strip 168x168 */}
              <div
                style={{
                  width:
                    (single.extensions?.leftBarWidth as number | undefined) ??
                    100,
                  height: 168,
                  background: "#121212",
                  color: "#fafafa",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  className="font-extrabold tracking-tight"
                  style={{
                    fontSize:
                      (single.extensions?.assetFontSize as number | undefined) ??
                      40,
                  }}
                >
                  {asset}
                </div>
              </div>
              {/* Right content area */}
              <div
                className="flex flex-col"
                style={{
                  width:
                    384 -
                    (((single.extensions?.leftBarWidth as number | undefined) ??
                      100) as number) -
                    0,
                  padding: "8px 14px 8px 14px",
                }}
              >
                <div
                  className="text-center font-medium leading-none mb-3 tracking-tight"
                  style={{
                    fontSize:
                      (single.extensions?.dateFontSize as number | undefined) ??
                      12,
                  }}
                >
                  {dateTimeStr}
                </div>
                <div className="flex-1 flex items-center justify-center overflow-hidden">
                  <div className="text-center max-w-full">
                    <div
                      className="font-black leading-none tracking-tight tabular-nums whitespace-nowrap"
                      style={{
                        letterSpacing: "-1px",
                        fontSize: priceFontSize,
                        transform: "translateZ(0)",
                      }}
                    >
                      {priceStr}
                    </div>
                  </div>
                </div>
                <div
                  className="mt-2 text-center font-semibold tracking-tight leading-none"
                  style={{
                    fontSize:
                      (single.extensions?.bottomFontSize as number | undefined) ??
                      13,
                  }}
                >
                  {(() => {
                    const periodLabel =
                      (single.extensions?.periodLabel as string) || "1 день";
                    const hasPercent =
                      single.portfolioChangePercent !== undefined &&
                      single.portfolioChangePercent !== null;
                    const hasAbs =
                      single.portfolioChangeAbsolute !== undefined &&
                      single.portfolioChangeAbsolute !== null;
                    if (!hasPercent && !hasAbs) return <>&nbsp;</>;

                    const percentPart = hasPercent ? (
                      <>
                        {periodLabel} {single.portfolioChangePercent! > 0 ? "+" : ""}
                        {single.portfolioChangePercent!.toFixed(2)}%
                      </>
                    ) : (
                      <>{periodLabel}</>
                    );

                    const absVal = single.portfolioChangeAbsolute as number | undefined;
                    let absPart: React.ReactNode = null;
                    if (hasAbs && typeof absVal === "number") {
                      const sign = absVal >= 0 ? "+" : "-";
                      const absNum = Math.abs(absVal);
                      const absStr = Number.isInteger(absNum)
                        ? String(absNum)
                        : absNum.toFixed(2).replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1");
                      absPart = (
                        <>
                          {" "}({sign}
                          {single.currencySymbol}
                          {absStr})
                        </>
                      );
                    }

                    return (
                      <>
                        {percentPart}
                        {absPart}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        } else {
          content = (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2">
              <div className="text-[13px] font-semibold tracking-wide">
                {single.name.toUpperCase()}
              </div>
              <div className="text-[28px] font-bold tabular-nums">
                {single.currencySymbol}
                {single.price.toFixed(2)}
              </div>
              {single.portfolioValue && (
                <div className="text-[10px] opacity-70">
                  Портфель: {single.currencySymbol}
                  {single.portfolioValue.toFixed(2)}
                  {single.portfolioChangePercent !== undefined && (
                    <span className="ml-1">
                      {single.portfolioChangePercent > 0 ? "+" : ""}
                      {single.portfolioChangePercent.toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
              <div className="text-[8px] opacity-50">
                {new Date(single.timestamp).toLocaleTimeString()}
              </div>
              {/* Removed in-display LED dot */}
            </div>
          );
        }
      } else if (displayInstruction?.type === "playlist") {
        // For simplicity, show first item for now
        const firstItem = displayInstruction.playlist.items[0];
        if (firstItem) {
          content = (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2">
              <div className="text-[9px] opacity-60">
                ПЛЕЙЛИСТ • {displayInstruction.playlist.items.length} эл.
              </div>
              <div className="text-[11px] font-semibold tracking-wide">
                {firstItem.name.toUpperCase()}
              </div>
              <div className="text-[24px] font-bold tabular-nums">
                {firstItem.currencySymbol}
                {firstItem.price.toFixed(2)}
              </div>
              <div className="text-[8px] opacity-50">
                {new Date(firstItem.timestamp).toLocaleTimeString()}
              </div>
            </div>
          );
        } else {
          content = (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2">
              <div className="text-[11px] font-semibold tracking-wide">
                ПЛЕЙЛИСТ
              </div>
              <div className="text-[10px] opacity-70">Пустой плейлист</div>
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
            <div className="text-[8px] opacity-50">Пульс активно</div>
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
          </div>
          {/* LED bar right side vertical */}
          {(() => {
            let ledColor: string | undefined;
            let ledBrightness: string | undefined;
            let flashCount: number | undefined;
            if (displayInstruction?.type === "single") {
              ledColor = displayInstruction.single.ledColor;
              ledBrightness = displayInstruction.single.ledBrightness;
              flashCount = displayInstruction.single.flashCount;
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
                className={`ml-1 h-[168px] rounded-sm border border-neutral-400 relative overflow-hidden flex flex-col ${
                  flash ? "led-flash" : ""
                }`}
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
        style={{
          top: 168 * scale + 8,
          left: 0,
        }}
      >
        {(() => {
          // Defaults: 384x168 pixels, active area 67.58mm x 29.57mm
          let widthMm = 67.58;
          let heightMm = 29.57;
          if (displayInstruction?.type === "single") {
            const ext = displayInstruction.single.extensions || {};
            const w = (ext as any).widthMm;
            const h = (ext as any).heightMm;
            if (typeof w === "number" && w > 0) widthMm = w;
            if (typeof h === "number" && h > 0) heightMm = h;
          }
          return `384x168 + LED ${scale > 1 ? `(${scale}x)` : ""} • ${widthMm.toFixed(2)}×${heightMm.toFixed(2)} mm`;
        })()}
      </div>
    </div>
  );
};
