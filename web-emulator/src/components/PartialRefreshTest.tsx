import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../api/client";
import { DeviceStateDto, DisplayFramesPayload, RefreshMode } from "../types/display";
import { HEIGHT, Mono, WIDTH, monoFromDrawing, packMono } from "../utils/bitmap";
import { MonoCanvas } from "./MonoCanvas";

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const PARTIAL_FIRMWARE_VERSION = 39;
const POLL_MS = 700;

// Price ticker: the header stays put, the number, arrow, sparkline and progress bar change
export const tickerFrame = (value: number, history: number[], from: number, to: number): Mono =>
  monoFromDrawing((ctx) => {
    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold 18px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText('TIGER / USD', 12, 26);
    const prev = history.length > 1 ? history[history.length - 2] : value;
    const delta = value - prev;
    ctx.textAlign = 'right';
    ctx.font = `bold 16px ${SANS}`;
    ctx.fillText(`${delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : '• '}${delta.toFixed(2)}`, WIDTH - 12, 26);
    ctx.font = `800 64px ${SANS}`;
    ctx.fillText(`${value.toFixed(2)} $`, WIDTH - 12, 98);

    // Sparkline over the last points
    const pts = history.slice(-40);
    const lo = Math.min(from, to);
    const span = Math.max(1, Math.abs(to - from));
    const x0 = 12;
    const w = WIDTH - 24;
    const yOf = (v: number) => 148 - ((v - lo) / span) * 36;
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((v, i) => {
      const x = x0 + (pts.length > 1 ? (i / 39) * w : 0);
      if (i === 0) ctx.moveTo(x, yOf(v));
      else ctx.lineTo(x, yOf(v));
    });
    ctx.stroke();

    // Progress from `from` to `to`
    const p = Math.min(1, Math.abs(value - from) / span);
    ctx.strokeRect(12.5, HEIGHT - 12.5, w, 7);
    ctx.fillRect(12, HEIGHT - 13, Math.round(w * p), 8);
  });

type RunState = { running: boolean; step: number; total: number; message: string };

const MODES: { id: RefreshMode; label: string; hint: string }[] = [
  { id: 'partial', label: 'Частичное', hint: 'Каждый шаг — частичное обновление (~0,4 с, без моргания); полное раз в 200 шагов' },
  { id: 'auto', label: 'Авто', hint: 'Как у обычных кадров: частичное, но полное каждые 30 обновлений или 10 минут' },
  { id: 'full', label: 'Полное', hint: 'Для сравнения: каждый шаг — полное обновление (~2 с, экран моргает)' },
];

export const PartialRefreshTest: React.FC<{ deviceId: string; state: DeviceStateDto | null; onChange: () => void }> = ({ deviceId, state, onChange }) => {
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(100);
  const [step, setStep] = useState(5);
  const [intervalSec, setIntervalSec] = useState(2);
  const [mode, setMode] = useState<RefreshMode>('partial');
  const [run, setRun] = useState<RunState>({ running: false, step: 0, total: 0, message: '' });
  const [lastMono, setLastMono] = useState<Mono | null>(null);
  const stopRef = useRef(false);

  const values = useMemo(() => {
    const s = Math.max(0.01, Math.abs(step)) * (to >= from ? 1 : -1);
    const out: number[] = [];
    for (let v = from; to >= from ? v < to : v > to; v += s) out.push(Math.round(v * 100) / 100);
    out.push(to);
    return out.slice(0, 500);
  }, [from, to, step]);

  const preview = useMemo(() => lastMono ?? tickerFrame(values[0], [values[0]], from, to), [lastMono, values, from, to]);
  const fw = state?.firmwareVersion ? parseInt(state.firmwareVersion.replace(/^v/i, ''), 10) : NaN;
  const diag = state?.diagnostics;

  useEffect(() => () => { stopRef.current = true; }, []);

  const putValue = async (i: number) => {
    const history = values.slice(0, i + 1);
    const mono = tickerFrame(values[i], history, from, to);
    setLastMono(mono);
    const payload: DisplayFramesPayload = {
      refreshInterval: 60,
      frames: [{ bitmap: packMono(mono), ledColor: 'off', ledBrightness: 'off', durationSec: 86400, refreshMode: mode }],
    };
    const resp = await apiClient.setDisplayFrames(deviceId, payload);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.message ?? `Ошибка ${resp.status}`);
    return data.displayHash as string;
  };

  // Paced by the device: the next value goes out as soon as the device has picked up the current one,
  // so every heartbeat carries a new number and none is skipped
  const start = async () => {
    stopRef.current = false;
    const durationSec = Math.min(900, Math.ceil(values.length * (intervalSec + 2)) + 60);
    setRun({ running: true, step: 0, total: values.length, message: 'Включаю быстрый heartbeat…' });
    try {
      const lv = await apiClient.startLive(deviceId, intervalSec, durationSec);
      if (!lv.ok) throw new Error((await lv.json().catch(() => ({}))).message ?? `Ошибка ${lv.status}`);
      for (let i = 0; i < values.length && !stopRef.current; i++) {
        const hash = await putValue(i);
        setRun({ running: true, step: i + 1, total: values.length, message: `Отправлено ${values[i]}, ждём устройство…` });
        const deadline = Date.now() + (intervalSec * 3 + 70) * 1000;
        for (;;) {
          if (stopRef.current) break;
          await new Promise((r) => setTimeout(r, POLL_MS));
          const st = await apiClient.getDevice(deviceId, true).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (st?.deliveredDisplayHash === hash) break;
          if (Date.now() > deadline) throw new Error('Устройство не забрало кадр — нет связи?');
        }
      }
      setRun((r) => ({ ...r, running: false, message: stopRef.current ? 'Остановлено' : 'Готово: дошли до конца' }));
    } catch (e: any) {
      setRun((r) => ({ ...r, running: false, message: e.message }));
    }
    // Back to the normal cadence; the last number stays on the screen
    await apiClient.stopLive(deviceId).catch(() => {});
    onChange();
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-neutral-500 leading-snug">
        Цена идёт от «с» до «по»: каждый шаг — новый кадр с тем же заголовком, другим числом и графиком. На прошивке v{PARTIAL_FIRMWARE_VERSION}+
        кадр, сменяющий кадр, рисуется частичным обновлением — без чёрно-белого моргания. На время теста сервер переводит устройство на heartbeat
        раз в {intervalSec} с (не дольше 15 мин), потом возвращает обычный интервал; последнее число остаётся на экране.
      </p>
      {!Number.isNaN(fw) && fw < PARTIAL_FIRMWARE_VERSION && (
        <div className="text-xs px-2 py-1.5 rounded bg-amber-50 text-amber-800">
          Прошивка v{fw}: частичного обновления ещё нет, каждый шаг будет полным (с морганием).
        </div>
      )}
      <div className="flex flex-wrap gap-4 items-start">
        <MonoCanvas mono={preview} scale={1} className="border" />
        <div className="flex flex-col gap-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-neutral-500">С
              <input type="number" value={from} disabled={run.running} onChange={(e) => setFrom(parseFloat(e.target.value) || 0)} className="border rounded px-2 py-1 text-sm text-neutral-900 w-24" />
            </label>
            <label className="flex flex-col text-neutral-500">По
              <input type="number" value={to} disabled={run.running} onChange={(e) => setTo(parseFloat(e.target.value) || 0)} className="border rounded px-2 py-1 text-sm text-neutral-900 w-24" />
            </label>
            <label className="flex flex-col text-neutral-500">Шаг
              <input type="number" min={0.01} value={step} disabled={run.running} onChange={(e) => setStep(parseFloat(e.target.value) || 1)} className="border rounded px-2 py-1 text-sm text-neutral-900 w-24" />
            </label>
            <label className="flex flex-col text-neutral-500" title="Интервал heartbeat на время теста (2–10 с); реальный шаг ≈ интервал + ~1–2 с на запрос">
              Интервал, с
              <input type="number" min={2} max={10} value={intervalSec} disabled={run.running}
                onChange={(e) => setIntervalSec(Math.max(2, Math.min(10, parseInt(e.target.value) || 2)))}
                className="border rounded px-2 py-1 text-sm text-neutral-900 w-24" />
            </label>
          </div>
          <div className="flex gap-1">
            {MODES.map((m) => (
              <button key={m.id} title={m.hint} disabled={run.running} onClick={() => setMode(m.id)}
                className={`px-2.5 py-1.5 rounded ${mode === m.id ? 'bg-blue-600 text-white' : 'bg-neutral-100 hover:bg-neutral-200'} disabled:opacity-60`}>
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-neutral-500">{MODES.find((m) => m.id === mode)?.hint}</span>
          <span className="text-neutral-500">{values.length} шагов, примерно {Math.ceil((values.length * (intervalSec + 1.5)) / 60)} мин</span>
          <div className="flex gap-2">
            {!run.running ? (
              <button onClick={start} disabled={!state || values.length < 2} className="px-3 py-1.5 rounded bg-blue-600 text-white font-medium disabled:opacity-50">Старт</button>
            ) : (
              <button onClick={() => { stopRef.current = true; }} className="px-3 py-1.5 rounded bg-orange-100 text-orange-700 font-medium">Стоп</button>
            )}
          </div>
        </div>
      </div>
      {(run.running || run.message) && (
        <div className="flex flex-col gap-1">
          <div className="h-2 bg-neutral-100 rounded overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${run.total ? (run.step / run.total) * 100 : 0}%` }} />
          </div>
          <div className="text-xs text-neutral-600">{run.step}/{run.total} · {run.message}</div>
        </div>
      )}
      <div className="text-xs text-neutral-600 border-t pt-2 flex flex-wrap gap-x-5 gap-y-1">
        <span>
          <span className="text-neutral-500">Быстрый heartbeat:</span>{' '}
          {state?.live?.active ? `да, раз в ${state.live.intervalSec} с` : 'нет'}
          {state?.deliveredRefreshInterval != null && <span className="text-neutral-400"> · устройство на {state.deliveredRefreshInterval} с</span>}
        </span>
        {diag?.lastRefresh != null ? (
          <>
            <span><span className="text-neutral-500">Последнее обновление экрана:</span> {String(diag.lastRefresh)}{diag.lastRefresh !== 'skip' && `, ${diag.lastRefreshMs} мс`}</span>
            <span><span className="text-neutral-500">Частичных подряд:</span> {String(diag.partialSinceFull)}</span>
            <span><span className="text-neutral-500">Всего с загрузки:</span> полных {String(diag.fullRefreshes)}, частичных {String(diag.partialRefreshes)}, пропущено {String(diag.skippedRefreshes)}</span>
          </>
        ) : (
          <span className="text-neutral-400">Статистика обновлений экрана — с прошивки v{PARTIAL_FIRMWARE_VERSION} (приходит со следующим heartbeat)</span>
        )}
      </div>
    </div>
  );
};
