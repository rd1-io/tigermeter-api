import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient, STAGING_TENANT_ID } from "../api/client";
import {
  DeviceDto,
  DeviceStateDto,
  DisplayFrame,
  DisplayFramesPayload,
  LED_BRIGHTNESSES,
  LED_BRIGHTNESS_LABELS,
  LED_COLORS,
  LED_COLOR_LABELS,
  LedBrightness,
  LedColor,
} from "../types/display";
import {
  DEFAULT_TONE,
  DitherMode,
  FitMode,
  Mono,
  ToneOptions,
  grayFromImage,
  grayToMono,
  invertMono,
  loadImageFile,
  packMono,
  unpackMono,
} from "../utils/bitmap";
import { TEST_IMAGES } from "../utils/testImages";
import { DEFAULT_TEXT, FontFamily, TEXT_LAYOUTS, TextAlign, TextSpec, renderText } from "../utils/textLayouts";
import { MonoCanvas } from "./MonoCanvas";
import { PartialRefreshTest } from "./PartialRefreshTest";

interface DeviceTestPageProps {
  scope: string;
  deviceId: string | null;
  onSelectDevice: (id: string | null) => void;
}

type Source = 'text' | 'image' | 'gallery';

interface LedSettings {
  ledColor: LedColor;
  ledBrightness: LedBrightness;
  durationSec: number;
  beep: boolean;
  flashCount: number;
}

interface QueuedFrame extends LedSettings {
  key: string;
  label: string;
  mono: Mono;
}

const STATE_POLL_MS = 3000;
const MAX_FRAMES = 8;

const DEFAULT_LED: LedSettings = { ledColor: 'green', ledBrightness: 'mid', durationSec: 30, beep: false, flashCount: 0 };

const LED_CSS: Record<LedColor, string> = {
  green: '#22c55e',
  red: '#ef4444',
  blue: '#3b82f6',
  yellow: '#f59e0b',
  cyan: '#06b6d4',
  magenta: '#d946ef',
  white: '#ffffff',
  rainbow: 'conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #d946ef, #ef4444)',
  off: '#e5e5e5',
};

const BRIGHTNESS_OPACITY: Record<LedBrightness, number> = { low: 0.3, mid: 0.6, high: 1, off: 0 };

const SEND_ERRORS: Record<string, string> = {
  'Device is not attached to a tenant': 'Устройство не привязано к тенанту — сначала привяжите его по коду.',
  'Device is on the staging tenant for OTA': 'Устройство временно на тенанте staging (автообновление), отправка кадров недоступна.',
  'Not found': 'Устройство не найдено (или принадлежит другому тенанту).',
};

let keySeq = 0;
const nextKey = () => `f${++keySeq}`;

const ago = (iso: string | null, now: number) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.floor(s / 60)} мин ${s % 60} с назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return new Date(iso).toLocaleString();
};

const shortHash = (h: string | null | undefined) => (h ? h.replace('sha256:', '').slice(0, 12) : '—');

const formatUptime = (sec: number | null) => {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} ч ${m} мин` : `${m} мин ${sec % 60} с`;
};

const formatKb = (bytes: unknown) => {
  if (typeof bytes !== 'number') return '?';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`;
};

const toFrame = (f: LedSettings & { mono: Mono }): DisplayFrame => ({
  bitmap: packMono(f.mono),
  ledColor: f.ledColor,
  ledBrightness: f.ledBrightness,
  durationSec: f.durationSec,
  beep: f.beep,
  flashCount: f.flashCount,
});

// Scenario frames carry their own caption so the tester can match the LED to what the screen says
const captionFrame = (tag: string, value: string, subtitle: string) =>
  renderText({ ...DEFAULT_TEXT, layout: 'sidebar', tag, value, subtitle, size: 34, autoFit: true });

const SCENARIOS: { id: string; title: string; hint: string; build: () => QueuedFrame[] }[] = [
  {
    id: 'colors',
    title: 'Все цвета LED',
    hint: '8 кадров по 10 с: каждый цвет на высокой яркости, название цвета на экране',
    build: () =>
      LED_COLORS.filter((c) => c !== 'off').map((c, i, all) => ({
        key: nextKey(),
        label: `LED: ${LED_COLOR_LABELS[c]}`,
        mono: captionFrame('LED', LED_COLOR_LABELS[c], `${c} · высокая · ${i + 1}/${all.length}`),
        ...DEFAULT_LED,
        ledColor: c,
        ledBrightness: 'high',
        durationSec: 10,
      })),
  },
  {
    id: 'brightness',
    title: 'Яркость LED',
    hint: 'Белый на low / mid / high и выключенный LED, по 10 с',
    build: () =>
      LED_BRIGHTNESSES.map((b, i) => ({
        key: nextKey(),
        label: `Яркость: ${LED_BRIGHTNESS_LABELS[b]}`,
        mono: captionFrame('LED', LED_BRIGHTNESS_LABELS[b], `white · ${b} · ${i + 1}/4`),
        ...DEFAULT_LED,
        ledColor: 'white' as LedColor,
        ledBrightness: b,
        durationSec: 10,
      })),
  },
  {
    id: 'sound',
    title: 'Звук и вспышки',
    hint: 'Сигнал; 3 вспышки красным; сигнал + 2 вспышки голубым. Срабатывают при первом показе каждого кадра после отправки, на следующих кругах — без них',
    build: () => [
      { key: nextKey(), label: 'Звук', mono: captionFrame('BEEP', 'Звуковой сигнал', 'beep · зелёный'), ...DEFAULT_LED, beep: true, durationSec: 10 },
      { key: nextKey(), label: '3 вспышки', mono: captionFrame('FLASH', '3 вспышки', 'flashCount 3 · красный'), ...DEFAULT_LED, ledColor: 'red', flashCount: 3, durationSec: 10 },
      { key: nextKey(), label: 'Звук + 2 вспышки', mono: captionFrame('B+F', 'Звук + 2 вспышки', 'beep · flashCount 2 · голубой'), ...DEFAULT_LED, ledColor: 'cyan', beep: true, flashCount: 2, durationSec: 10 },
    ],
  },
  {
    id: 'gallery',
    title: 'Галерея по кругу',
    hint: '8 тестовых картинок по 10 с, LED выключен',
    build: () =>
      ['edges', 'grid', 'checker8', 'gradient', 'bigtext', 'logo', 'ticker', 'halves'].map((id) => {
        const img = TEST_IMAGES.find((t) => t.id === id)!;
        return { key: nextKey(), label: img.title, mono: img.render(), ...DEFAULT_LED, ledColor: 'off' as LedColor, ledBrightness: 'off' as LedBrightness, durationSec: 10 };
      }),
  },
];

// `bar`: the device's light strip — `size` is its width and it stretches to the parent's height.
// Solid colors and brightness crossfade over 1 s like firmware v40; rainbow switches instantly.
const LED_FADE = 'background-color 1s ease-in-out, opacity 1s ease-in-out, box-shadow 1s ease-in-out';

const LedDot: React.FC<{ color: LedColor; brightness: LedBrightness; flashKey?: number; flashes?: number; size?: number; bar?: boolean }> = ({
  color,
  brightness,
  flashKey,
  flashes = 0,
  size = 28,
  bar = false,
}) => {
  const off = color === 'off' || brightness === 'off';
  const rainbow = color === 'rainbow' && !off;
  // Fading to off keeps the last solid color so it dims out instead of turning grey
  const lastSolid = useRef<LedColor>('green');
  if (!off && color !== 'rainbow') lastSolid.current = color;
  const solid = off || color === 'rainbow' ? lastSolid.current : color;
  const shape = bar ? 'rounded-sm' : 'rounded-full';
  return (
    <span
      title="LED"
      className={`relative inline-block shrink-0 ${shape} border border-neutral-300 bg-neutral-200 ${bar ? 'self-stretch' : ''}`}
      style={bar ? { width: size } : { width: size, height: size }}
    >
      <span
        key={flashKey}
        className={`absolute inset-0 ${shape} ${rainbow ? (bar ? 'led-rainbow-bar' : 'led-rainbow') : ''}`}
        style={{
          backgroundColor: rainbow ? undefined : LED_CSS[solid],
          backgroundImage: rainbow
            ? bar ? 'linear-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #d946ef)' : LED_CSS.rainbow
            : undefined,
          opacity: off ? 0 : BRIGHTNESS_OPACITY[brightness],
          boxShadow: rainbow ? undefined : `0 0 ${bar ? size : size / 2}px ${LED_CSS[solid]}`,
          transition: rainbow ? undefined : LED_FADE,
          animation: flashKey && flashes > 0 && !off ? `ledPulse 0.9s ease-in-out ${flashes}` : undefined,
        }}
      />
    </span>
  );
};

const Section: React.FC<{ title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, right, children, className }) => (
  <div className={`bg-white rounded-md border shadow-sm ${className ?? ''}`}>
    <div className="px-4 py-2.5 border-b flex items-center gap-3">
      <h3 className="font-semibold text-sm">{title}</h3>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const btn = 'text-xs px-2.5 py-1.5 rounded bg-neutral-100 hover:bg-neutral-200 disabled:opacity-50';
const btnActive = 'text-xs px-2.5 py-1.5 rounded bg-blue-600 text-white';

export const DeviceTestPage: React.FC<DeviceTestPageProps> = ({ scope, deviceId, onSelectDevice }) => {
  const isOps = scope === 'ops';
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [state, setState] = useState<DeviceStateDto | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [source, setSource] = useState<Source>('text');
  const [text, setText] = useState<TextSpec>(DEFAULT_TEXT);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState("");
  const [imageError, setImageError] = useState("");
  const [fit, setFit] = useState<FitMode>('contain');
  const [background, setBackground] = useState<'white' | 'black'>('white');
  const [tone, setTone] = useState<ToneOptions>(DEFAULT_TONE);
  const [galleryId, setGalleryId] = useState(TEST_IMAGES[0].id);
  const [invertAll, setInvertAll] = useState(false);
  const [showBattery, setShowBattery] = useState(false);

  const [led, setLed] = useState<LedSettings>(DEFAULT_LED);
  const [flashKey, setFlashKey] = useState(0);
  const [refreshInterval, setRefreshInterval] = useState(15);
  const [queue, setQueue] = useState<QueuedFrame[]>([]);
  const [rotating, setRotating] = useState(false);
  const [rotationIdx, setRotationIdx] = useState(0);

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string; hash?: string; prevInterval?: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- device list + live state ---
  const loadDevices = useCallback(async (quiet = true) => {
    try {
      const resp = await apiClient.listDevices(quiet);
      if (resp.ok) setDevices(await resp.json());
    } catch {}
  }, []);

  useEffect(() => {
    loadDevices();
    const iv = setInterval(loadDevices, 15000);
    return () => clearInterval(iv);
  }, [loadDevices]);

  const loadState = useCallback(async (quiet = true) => {
    if (!deviceId) return;
    try {
      const resp = await apiClient.getDevice(deviceId, quiet);
      if (resp.ok) {
        setState(await resp.json());
        setStateError(null);
      } else {
        setStateError(resp.status === 404 ? 'Устройство не найдено' : `Ошибка ${resp.status}`);
      }
    } catch (e: any) {
      setStateError(e.message);
    }
  }, [deviceId]);

  useEffect(() => {
    setState(null);
    setSendResult(null);
    if (!deviceId) return;
    loadState();
    const iv = setInterval(loadState, STATE_POLL_MS);
    return () => clearInterval(iv);
  }, [deviceId, loadState]);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // --- current frame bitmap from the selected source ---
  const imageGray = useMemo(() => (image ? grayFromImage(image, fit, background) : null), [image, fit, background]);

  const sourceMono = useMemo<Mono>(() => {
    if (source === 'text') return renderText(text);
    if (source === 'image') return imageGray ? grayToMono(imageGray, tone) : renderText({ ...DEFAULT_TEXT, layout: 'single', value: 'Загрузите картинку', size: 28 });
    return (TEST_IMAGES.find((t) => t.id === galleryId) ?? TEST_IMAGES[0]).render();
  }, [source, text, imageGray, tone, galleryId]);

  const currentMono = useMemo(() => (invertAll ? invertMono(sourceMono) : sourceMono), [sourceMono, invertAll]);

  const currentLabel = useMemo(() => {
    if (source === 'text') return `Текст: ${(text.layout === 'multiline' ? text.body : text.value).slice(0, 24)}`;
    if (source === 'image') return `Картинка: ${imageName || '—'}`;
    return `Галерея: ${TEST_IMAGES.find((t) => t.id === galleryId)?.title ?? ''}`;
  }, [source, text, imageName, galleryId]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setImageError("");
    try {
      const img = await loadImageFile(file);
      setImage(img);
      setImageName(file.name);
      setSource('image');
    } catch (e: any) {
      setImageError(e.message);
    }
  };

  // --- rotation preview of the queue (capped at 5 s per frame) ---
  useEffect(() => {
    if (!rotating || queue.length === 0) return;
    const f = queue[rotationIdx % queue.length];
    if (f.beep || f.flashCount) setFlashKey((k) => k + 1);
    const t = setTimeout(() => setRotationIdx((i) => (i + 1) % queue.length), Math.min(f.durationSec, 5) * 1000);
    return () => clearTimeout(t);
  }, [rotating, rotationIdx, queue]);

  useEffect(() => {
    if (queue.length === 0) setRotating(false);
  }, [queue.length]);

  const previewFrame = rotating && queue.length ? queue[rotationIdx % queue.length] : null;
  const previewMono = previewFrame ? previewFrame.mono : currentMono;
  const previewLed: LedSettings = previewFrame ?? led;

  // --- send ---
  const send = async (frames: (LedSettings & { mono: Mono })[]) => {
    if (!deviceId || frames.length === 0) return;
    setSending(true);
    setSendResult(null);
    const payload: DisplayFramesPayload = { frames: frames.map(toFrame), refreshInterval };
    const prevInterval = state?.refreshInterval ?? 60;
    try {
      const expected = await apiClient.computeDisplayHash(payload);
      const resp = await apiClient.setDisplayFrames(deviceId, payload);
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        const match = data.displayHash === expected;
        setSendResult({
          ok: true,
          hash: data.displayHash,
          prevInterval,
          text: `Отправлено ${frames.length} кадр(ов), версия ${data.displayVersion}. Хеш ${shortHash(data.displayHash)}${match ? ' совпадает с локальным' : ' НЕ совпадает с локальным ' + shortHash(expected)}.`,
        });
        loadState();
      } else {
        setSendResult({ ok: false, text: SEND_ERRORS[data.message] ?? data.message ?? `Ошибка ${resp.status}` });
      }
    } catch (e: any) {
      setSendResult({ ok: false, text: 'Не удалось подключиться: ' + e.message });
    }
    setSending(false);
  };

  const sendCurrent = () => send([{ ...led, mono: currentMono }]);

  const addToQueue = () => {
    if (queue.length >= MAX_FRAMES) return;
    setQueue((q) => [...q, { key: nextKey(), label: currentLabel, mono: currentMono, ...led }]);
  };

  const updateQueued = (key: string, patch: Partial<QueuedFrame>) => setQueue((q) => q.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const moveQueued = (idx: number, dir: -1 | 1) =>
    setQueue((q) => {
      const j = idx + dir;
      if (j < 0 || j >= q.length) return q;
      const next = [...q];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const loadCurrentFromServer = async () => {
    if (!deviceId) return;
    const resp = await apiClient.getDeviceDisplay(deviceId);
    if (!resp.ok) {
      setSendResult({ ok: false, text: resp.status === 404 ? 'На сервере нет кадров для этого устройства' : `Ошибка ${resp.status}` });
      return;
    }
    const data: DisplayFramesPayload = await resp.json();
    setQueue(
      data.frames.map((f, i) => ({
        key: nextKey(),
        label: `С сервера #${i + 1}`,
        mono: unpackMono(f.bitmap),
        ledColor: f.ledColor,
        ledBrightness: f.ledBrightness,
        durationSec: f.durationSec,
        beep: !!f.beep,
        flashCount: f.flashCount ?? 0,
      })),
    );
    setRefreshInterval(data.refreshInterval);
  };

  // --- device settings ---
  const toggleSetting = async (key: 'autoUpdate' | 'demoMode') => {
    if (!state) return;
    if (key === 'demoMode' && !state.demoMode &&
      !confirm('Демо-режим: при следующем heartbeat устройство перезагрузится в демо-экран и перестанет связываться с сервером. Выключить его можно только локально (точка доступа устройства → Disable Demo Mode). Включить?')) return;
    await apiClient.updateDeviceSettings(state.id, { [key]: !state[key] });
    loadState();
  };

  const factoryReset = async () => {
    if (!state || !confirm('Сбросить устройство к заводским настройкам? Оно отвяжется от тенанта и сотрёт Wi‑Fi.')) return;
    const resp = await apiClient.factoryReset(state.id);
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert(data.message ?? `Ошибка ${resp.status}`);
    }
    loadState();
  };

  // --- derived state ---
  const testable = devices.filter((d) => d.status === 'active');
  const selectedInList = devices.find((d) => d.id === deviceId);
  const online = state?.lastSeen ? now - new Date(state.lastSeen).getTime() < Math.max(120, (state.refreshInterval ?? 60) * 2 + 15) * 1000 : false;
  const latest = state?.latestFirmwareVersion ?? 0;
  const fwNum = state?.firmwareVersion ? parseInt(state.firmwareVersion.replace(/^v/i, ''), 10) : NaN;
  const isStaging = state?.tenantId === STAGING_TENANT_ID;

  const delivery = (() => {
    if (!state?.displayHash) return { cls: 'bg-neutral-100 text-neutral-600', text: 'Кадров нет — устройство показывает «Waiting for content»' };
    if (state.displayBlocked) return { cls: 'bg-red-100 text-red-800', text: `Доставка остановлена: устройство ${state.displayRebootCount} раза перезагрузилось сразу после получения этих кадров. Отправьте новые кадры, чтобы попробовать снова` };
    if (!state.framesSupported) return { cls: 'bg-amber-100 text-amber-800', text: `Прошивка ${state.firmwareVersion ?? '?'} падает на кадрах без PSRAM — сервер не отдаёт ей кадры до обновления на v${state.minFramesFirmwareVersion}+ (OTA через ~1 мин после загрузки, затем раз в час)` };
    const n = state.frameCount;
    const of = (i: number) => (n > 1 ? `кадр ${i + 1}/${n}` : 'кадр');
    if (state.deviceFrameIndex != null && state.deviceFrameIndex === state.deliveredFrameIndex)
      return { cls: 'bg-green-100 text-green-800', text: `Применено: устройство показывает ${of(state.deviceFrameIndex)} и подтвердило его хеш` };
    // Rotation heartbeats land at frame switches: each one confirms the previous frame and gets the next
    if (n > 1 && state.deviceFrameIndex != null && state.deliveredFrameIndex != null && state.displayRebootCount === 0)
      return { cls: 'bg-green-100 text-green-800', text: `Ротация идёт: устройство подтвердило кадр ${state.deviceFrameIndex + 1}/${n} и ${ago(state.displayDeliveredAt, now)} получило кадр ${state.deliveredFrameIndex + 1}/${n}` };
    if (state.deliveredFrameIndex != null) return { cls: 'bg-blue-100 text-blue-800', text: `Доставлен ${of(state.deliveredFrameIndex)} ${ago(state.displayDeliveredAt, now)}, подтверждение придёт со следующим heartbeat` };
    return { cls: 'bg-amber-100 text-amber-800', text: 'Ожидает heartbeat: устройство ещё не забрало новые кадры' };
  })();

  const eta = (() => {
    if (!state?.lastSeen || !sendResult?.ok || state.deliveredFrameIndex != null) return null;
    const due = new Date(state.lastSeen).getTime() + (sendResult.prevInterval ?? 60) * 1000;
    const s = Math.round((due - now) / 1000);
    return s > 0 ? `следующий heartbeat примерно через ${s} с` : `heartbeat ожидался ${-s} с назад`;
  })();

  // --- render ---
  return (
    <div className="flex flex-col gap-4">
      {/* Device picker */}
      <div className="bg-white rounded-md border shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Тест устройства</h2>
        <select
          value={deviceId ?? ''}
          onChange={(e) => onSelectDevice(e.target.value || null)}
          className="border rounded px-2 py-1.5 text-sm min-w-[22rem]"
        >
          <option value="">— выберите привязанное устройство —</option>
          {testable.map((d) => (
            <option key={d.id} value={d.id}>
              {d.mac} · {d.name || 'без названия'}{isOps && d.tenantId ? ` · ${d.tenantId}` : ''} · v{(d.firmwareVersion || '?').replace(/^v/i, '')}
            </option>
          ))}
          {deviceId && !testable.some((d) => d.id === deviceId) && (
            <option value={deviceId}>{selectedInList?.mac ?? deviceId} ({selectedInList?.status ?? 'загрузка'})</option>
          )}
        </select>
        <button onClick={() => loadDevices(false)} className="text-xs text-blue-600">Обновить список</button>
        <span className="text-xs text-neutral-500 ml-auto">
          {isOps
            ? 'Ops: отправка от имени тенанта устройства через /admin'
            : 'Отправка через API тенанта (PUT /devices/:id/display)'}
        </span>
      </div>

      {!deviceId && (
        <div className="bg-white rounded-md border shadow-sm p-8 text-center text-sm text-neutral-500">
          Выберите устройство выше. Непривязанное устройство сначала привяжите по коду на вкладке «Устройства».
        </div>
      )}

      {deviceId && (
        <>
          {/* Live state */}
          <Section
            title="Состояние"
            right={
              <>
                <span className="text-[11px] text-neutral-400">обновляется каждые 3 с</span>
                <button onClick={() => loadState(false)} className="text-xs text-blue-600">Обновить</button>
              </>
            }
          >
            {stateError && <div className="text-sm text-red-600 mb-2">{stateError}</div>}
            {state && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
                  <div>
                    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${online ? 'bg-green-500' : 'bg-neutral-300'}`} />
                    <span className="text-neutral-500">Heartbeat:</span> {ago(state.lastSeen, now)}
                  </div>
                  <div>
                    <span className="text-neutral-500">Статус:</span> {state.status}
                    {state.tenantId && <span className="text-neutral-400"> · {state.tenantId}</span>}
                  </div>
                  <div>
                    <span className="text-neutral-500">Прошивка:</span> v{Number.isNaN(fwNum) ? state.firmwareVersion ?? '?' : fwNum}
                    {latest > 0 && !Number.isNaN(fwNum) && (
                      <span className={fwNum >= latest ? 'text-green-700' : 'text-amber-700'}> {fwNum >= latest ? '(актуальная)' : `(доступна v${latest})`}</span>
                    )}
                  </div>
                  <div>
                    <span className="text-neutral-500">Батарея:</span> {state.battery ?? '?'}%
                    {state.battery != null && state.battery < 5 && <span className="text-red-600"> · значок на экране</span>}
                  </div>
                  <div><span className="text-neutral-500">RSSI:</span> {state.rssi ?? '?'} дБм</div>
                  <div><span className="text-neutral-500">IP:</span> <span className="font-mono text-xs">{state.ip ?? '—'}</span></div>
                  <div><span className="text-neutral-500">Аптайм:</span> {formatUptime(state.uptimeSeconds)}</div>
                  <div title="Из кадров на сервере; устройство переходит на него после доставки"><span className="text-neutral-500">refreshInterval:</span> {state.refreshInterval ?? 60} с</div>
                </div>

                <div className="border-t pt-3 grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
                  <div>
                    <span className="text-neutral-500">На сервере:</span> <span className="font-mono text-xs">{shortHash(state.displayHash)}</span>
                    <span className="text-neutral-400"> · v{state.displayVersion} · {state.frameCount} кадр.</span>
                  </div>
                  <div><span className="text-neutral-500">Обновлено:</span> {ago(state.displayUpdatedAt, now)}</div>
                  <div>
                    <span className="text-neutral-500">Доставлено:</span> <span className="font-mono text-xs">{shortHash(state.deliveredDisplayHash)}</span>
                    <span className="text-neutral-400"> · {ago(state.displayDeliveredAt, now)}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500">Показывает устройство:</span> <span className="font-mono text-xs">{shortHash(state.reportedDisplayHash)}</span>
                  </div>
                </div>
                {state.rotation && state.frameCount > 1 && (
                  <div className="text-sm" title="Ротацию ведёт сервер: устройство держит один кадр и получает следующий с heartbeat в момент смены (± несколько секунд); без связи кадр не меняется">
                    <span className="text-neutral-500">Ротация на сервере:</span> сейчас кадр {state.rotation.currentIndex + 1}/{state.frameCount}
                    {state.rotation.nextSwitchInSec != null && <>, смена через {state.rotation.nextSwitchInSec} с</>}
                    <span className="text-neutral-400"> · круг {state.rotation.cycleSec} с ({state.rotation.effectiveDurations.join(' + ')})</span>
                    <span className="text-neutral-500"> · на устройстве:</span> {state.deviceFrameIndex != null ? `кадр ${state.deviceFrameIndex + 1}` : '—'}
                  </div>
                )}
                <div className={`text-sm px-3 py-2 rounded ${delivery.cls}`}>
                  {delivery.text}
                  {eta && <span className="opacity-80"> · {eta}</span>}
                </div>
                {!state.displayBlocked && state.displayRebootCount > 0 && (
                  <div className="text-sm px-3 py-2 rounded bg-red-50 text-red-800">
                    Устройство перезагрузилось сразу после получения кадров ({state.displayRebootCount}). Если повторится, сервер перестанет их отдавать.
                  </div>
                )}
                {state.diagnostics ? (
                  <div className="border-t pt-3 text-sm">
                    <div className="text-neutral-500 mb-1">Диагностика прошивки (последний heartbeat)</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5">
                      <div title="Причина последней перезагрузки (esp_reset_reason)">
                        <span className="text-neutral-500">Перезагрузка:</span>{' '}
                        <span className={['panic', 'int_wdt', 'task_wdt', 'wdt', 'brownout'].includes(String(state.diagnostics.resetReason)) ? 'text-red-700 font-medium' : ''}>
                          {String(state.diagnostics.resetReason ?? '?')}
                        </span>
                      </div>
                      <div title="Где была прошивка перед перезагрузкой (сохраняется в RTC; none — после включения питания)">
                        <span className="text-neutral-500">Этап до неё:</span> <span className="font-mono text-xs">{String(state.diagnostics.prevStage ?? '?')}</span>
                      </div>
                      <div>
                        <span className="text-neutral-500">PSRAM:</span>{' '}
                        {state.diagnostics.psram
                          ? `есть, ${formatKb(state.diagnostics.psramSize)} (свободно ${formatKb(state.diagnostics.freePsram)})`
                          : <span className="text-amber-700">нет</span>}
                      </div>
                      <div title="Буферы кадров на устройстве; сервер всегда шлёт один кадр, так что хватает одного">
                        <span className="text-neutral-500">Буферов кадров:</span> {String(state.diagnostics.frameBuffers ?? '?')}
                      </div>
                      <div title="Свободно / минимум с загрузки / крупнейший блок">
                        <span className="text-neutral-500">Heap:</span> {formatKb(state.diagnostics.freeHeap)} / мин. {formatKb(state.diagnostics.minFreeHeap)} / блок {formatKb(state.diagnostics.maxAllocHeap)}
                      </div>
                      <div title="Минимальный запас стека основной задачи">
                        <span className="text-neutral-500">Запас стека:</span> {String(state.diagnostics.stackFree ?? '?')} Б
                      </div>
                      {state.diagnostics.lastResponseBytes != null && (
                        <div><span className="text-neutral-500">Ответ heartbeat:</span> {formatKb(state.diagnostics.lastResponseBytes)}</div>
                      )}
                      {state.diagnostics.lastRefresh != null && (
                        <div title="Как прошивка (v39+) обновила экран в последний раз: partial — без моргания, full — с очисткой, skip — картинка не изменилась">
                          <span className="text-neutral-500">Обновление экрана:</span> {String(state.diagnostics.lastRefresh)}
                          {state.diagnostics.lastRefresh !== 'skip' && <> · {String(state.diagnostics.lastRefreshMs)} мс</>}
                          <span className="text-neutral-400"> · частичных подряд {String(state.diagnostics.partialSinceFull)}</span>
                        </div>
                      )}
                      {state.diagnostics.ledFades != null && (
                        <div title="Плавные переходы LED (v40+): сколько было с загрузки, длительность и шаги последнего, сколько прервано вспышкой/радугой/системным цветом">
                          <span className="text-neutral-500">Переходы LED:</span> {String(state.diagnostics.ledFades)}
                          <span className="text-neutral-400"> · последний {String(state.diagnostics.lastFadeMs)} мс / {String(state.diagnostics.lastFadeSteps)} шагов · прервано {String(state.diagnostics.fadeInterrupts)}</span>
                        </div>
                      )}
                      {state.diagnostics.lastError && (
                        <div className="md:col-span-2">
                          <span className="text-neutral-500">Последняя ошибка:</span> <span className="font-mono text-xs text-red-700">{String(state.diagnostics.lastError)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-neutral-400">Диагностика прошивки появится с v38.</div>
                )}
                {isStaging && (
                  <div className="text-sm px-3 py-2 rounded bg-amber-50 text-amber-800">
                    Устройство на тенанте staging: оно обновляет прошивку и затем снова покажет код привязки. Отправка кадров недоступна.
                  </div>
                )}
              </div>
            )}
          </Section>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-4">
            {/* Content source + preview */}
            <Section
              title="Изображение кадра"
              right={(['text', 'image', 'gallery'] as Source[]).map((s) => (
                <button key={s} onClick={() => setSource(s)} className={source === s ? btnActive : btn}>
                  {s === 'text' ? 'Текст' : s === 'image' ? 'Картинка' : 'Тестовые картинки'}
                </button>
              ))}
            >
              <div className="flex flex-col gap-4">
                <div className="flex flex-col items-start gap-2">
                  <div className="p-3 bg-neutral-800 rounded-lg inline-flex items-stretch gap-3">
                    <MonoCanvas mono={previewMono} scale={2} lowBattery={showBattery} />
                    <LedDot bar size={16} color={previewLed.ledColor} brightness={previewLed.ledBrightness} flashKey={flashKey} flashes={previewLed.flashCount} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600">
                    {previewFrame ? (
                      <span className="text-orange-700">Превью ротации: {previewFrame.label} ({(rotationIdx % queue.length) + 1}/{queue.length})</span>
                    ) : (
                      <span>384×168, 1 бит — ровно то, что получит устройство</span>
                    )}
                    <label className="flex items-center gap-1"><input type="checkbox" checked={invertAll} onChange={(e) => setInvertAll(e.target.checked)} /> Инверсия</label>
                    <label className="flex items-center gap-1" title="Прошивка рисует значок поверх кадра, когда заряд ниже 5%">
                      <input type="checkbox" checked={showBattery} onChange={(e) => setShowBattery(e.target.checked)} /> Значок низкого заряда (только превью)
                    </label>
                  </div>
                </div>

                {source === 'text' && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-1">
                      {TEXT_LAYOUTS.map((l) => (
                        <button key={l.id} title={l.hint} onClick={() => setText({ ...text, layout: l.id })} className={text.layout === l.id ? btnActive : btn}>
                          {l.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-neutral-500">{TEXT_LAYOUTS.find((l) => l.id === text.layout)?.hint}. Текст растрируется здесь — прошивка v5 показывает только битмапы.</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                      {text.layout === 'value' && (
                        <label className="flex flex-col text-xs text-neutral-500">Заголовок
                          <input value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })} className="border rounded px-2 py-1 text-sm text-neutral-900" />
                        </label>
                      )}
                      {text.layout === 'sidebar' && (
                        <label className="flex flex-col text-xs text-neutral-500">Тег на плашке
                          <input value={text.tag} maxLength={6} onChange={(e) => setText({ ...text, tag: e.target.value })} className="border rounded px-2 py-1 text-sm text-neutral-900" />
                        </label>
                      )}
                      {text.layout !== 'multiline' && (
                        <label className="flex flex-col text-xs text-neutral-500">{text.layout === 'sidebar' ? 'Строка 1' : 'Значение'}
                          <input value={text.value} onChange={(e) => setText({ ...text, value: e.target.value })} className="border rounded px-2 py-1 text-sm text-neutral-900" />
                        </label>
                      )}
                      {(text.layout === 'value' || text.layout === 'sidebar') && (
                        <label className="flex flex-col text-xs text-neutral-500">{text.layout === 'sidebar' ? 'Строка 2' : 'Подпись снизу'}
                          <input value={text.subtitle} onChange={(e) => setText({ ...text, subtitle: e.target.value })} className="border rounded px-2 py-1 text-sm text-neutral-900" />
                        </label>
                      )}
                      {text.layout === 'multiline' && (
                        <label className="flex flex-col text-xs text-neutral-500 md:col-span-3">Текст
                          <textarea value={text.body} rows={3} onChange={(e) => setText({ ...text, body: e.target.value })} className="border rounded px-2 py-1 text-sm text-neutral-900" />
                        </label>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <label className="flex items-center gap-1">Шрифт
                        <select value={text.font} onChange={(e) => setText({ ...text, font: e.target.value as FontFamily })} className="border rounded px-1 py-0.5">
                          <option value="sans">Без засечек</option>
                          <option value="serif">С засечками</option>
                          <option value="mono">Моноширинный</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-1">Размер
                        <input type="range" min={10} max={120} value={text.size} onChange={(e) => setText({ ...text, size: parseInt(e.target.value) })} />
                        <span className="w-10">{text.size}px</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={text.bold} onChange={(e) => setText({ ...text, bold: e.target.checked })} /> Жирный
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={text.autoFit} onChange={(e) => setText({ ...text, autoFit: e.target.checked })} /> Вписать по ширине
                      </label>
                      {text.layout !== 'sidebar' && (
                        <span className="flex gap-1">
                          {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
                            <button key={a} onClick={() => setText({ ...text, align: a })} className={text.align === a ? btnActive : btn}>
                              {a === 'left' ? 'Слева' : a === 'center' ? 'Центр' : 'Справа'}
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {source === 'image' && (
                  <div
                    className="flex flex-col gap-3"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFile(e.dataTransfer.files?.[0]);
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white">Выбрать файл</button>
                      <span className="text-xs text-neutral-500">{imageName || 'PNG, JPG, BMP, GIF, WebP — или перетащите сюда'}</span>
                      {image && <span className="text-xs text-neutral-400">{image.width}×{image.height}</span>}
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/bmp,image/gif,image/webp,.bmp"
                        className="hidden"
                        onChange={(e) => {
                          handleFile(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </div>
                    {imageError && <div className="text-xs text-red-600">{imageError}</div>}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                      <label className="flex items-center gap-2">Масштаб
                        <select value={fit} onChange={(e) => setFit(e.target.value as FitMode)} className="border rounded px-1 py-0.5">
                          <option value="contain">Вписать целиком</option>
                          <option value="cover">Заполнить (обрезать)</option>
                          <option value="stretch">Растянуть</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2">Поля
                        <select value={background} onChange={(e) => setBackground(e.target.value as 'white' | 'black')} className="border rounded px-1 py-0.5">
                          <option value="white">Белые</option>
                          <option value="black">Чёрные</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2">Дизеринг
                        <select value={tone.dither} onChange={(e) => setTone({ ...tone, dither: e.target.value as DitherMode })} className="border rounded px-1 py-0.5">
                          <option value="none">Нет (порог)</option>
                          <option value="floyd">Floyd–Steinberg</option>
                          <option value="atkinson">Atkinson</option>
                          <option value="bayer">Bayer 4×4</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={tone.invert} onChange={(e) => setTone({ ...tone, invert: e.target.checked })} /> Негатив
                      </label>
                      <label className="flex items-center gap-2">Порог
                        <input type="range" min={0} max={255} value={tone.threshold} onChange={(e) => setTone({ ...tone, threshold: parseInt(e.target.value) })} className="flex-1" />
                        <span className="w-8">{tone.threshold}</span>
                      </label>
                      <label className="flex items-center gap-2">Яркость
                        <input type="range" min={-100} max={100} value={tone.brightness} onChange={(e) => setTone({ ...tone, brightness: parseInt(e.target.value) })} className="flex-1" />
                        <span className="w-8">{tone.brightness}</span>
                      </label>
                      <label className="flex items-center gap-2">Контраст
                        <input type="range" min={-100} max={100} value={tone.contrast} onChange={(e) => setTone({ ...tone, contrast: parseInt(e.target.value) })} className="flex-1" />
                        <span className="w-8">{tone.contrast}</span>
                      </label>
                      <button onClick={() => setTone(DEFAULT_TONE)} className={`${btn} justify-self-start`}>Сбросить настройки</button>
                    </div>
                  </div>
                )}

                {source === 'gallery' && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {TEST_IMAGES.map((t) => (
                      <GalleryTile key={t.id} id={t.id} title={t.title} hint={t.hint} active={galleryId === t.id} onClick={() => setGalleryId(t.id)} />
                    ))}
                  </div>
                )}
              </div>
            </Section>

            {/* LED + send */}
            <div className="flex flex-col gap-4">
              <Section title="LED, звук, длительность">
                <div className="flex flex-col gap-3 text-sm">
                  <div>
                    <div className="text-xs text-neutral-500 mb-1">Цвет</div>
                    <div className="grid grid-cols-3 gap-1">
                      {LED_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setLed({ ...led, ledColor: c })}
                          className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border ${led.ledColor === c ? 'border-blue-600 bg-blue-50' : 'border-transparent bg-neutral-100'}`}
                        >
                          <LedDot color={c} brightness="high" size={12} />
                          {LED_COLOR_LABELS[c]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-neutral-500 mb-1">Яркость</div>
                    <div className="flex gap-1">
                      {LED_BRIGHTNESSES.map((b) => (
                        <button key={b} onClick={() => setLed({ ...led, ledBrightness: b })} className={led.ledBrightness === b ? btnActive : btn}>
                          {LED_BRIGHTNESS_LABELS[b]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col text-xs text-neutral-500">Вспышки (0–10)
                      <input type="number" min={0} max={10} value={led.flashCount}
                        onChange={(e) => setLed({ ...led, flashCount: Math.max(0, Math.min(10, parseInt(e.target.value) || 0)) })}
                        className="border rounded px-2 py-1 text-sm text-neutral-900" />
                    </label>
                    <label className="flex flex-col text-xs text-neutral-500">Длительность кадра, с
                      <input type="number" min={1} max={86400} value={led.durationSec}
                        onChange={(e) => setLed({ ...led, durationSec: Math.max(1, Math.min(86400, parseInt(e.target.value) || 1)) })}
                        className="border rounded px-2 py-1 text-sm text-neutral-900" />
                    </label>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={led.beep} onChange={(e) => setLed({ ...led, beep: e.target.checked })} /> Звуковой сигнал
                    </label>
                    <button onClick={() => setFlashKey((k) => k + 1)} className={`${btn} ml-auto`} disabled={!led.flashCount}>Показать вспышки</button>
                  </div>
                  <p className="text-[11px] text-neutral-500 leading-snug">
                    Звук и вспышки срабатывают при первом показе каждого кадра после отправки набора; на следующих кругах ротации и после перезагрузки устройства — без них. Вспышки идут на полной яркости;
                    у «Радуги» вспышка зелёная. Яркость «Выкл» гасит LED при любом цвете.
                  </p>
                </div>
              </Section>

              <Section title="Отправка">
                <div className="flex flex-col gap-3">
                  <label className="flex items-center justify-between text-xs text-neutral-500">
                    <span>Интервал heartbeat (refreshInterval), с</span>
                    <input type="number" min={10} max={3600} value={refreshInterval}
                      onChange={(e) => setRefreshInterval(Math.max(10, Math.min(3600, parseInt(e.target.value) || 10)))}
                      className="border rounded px-2 py-1 text-sm text-neutral-900 w-20" />
                  </label>
                  <p className="text-[11px] text-neutral-500 leading-snug">
                    Максимальный интервал heartbeat (сейчас {state?.refreshInterval ?? 60} с). При нескольких кадрах сервер сам назначает интервал так, чтобы устройство пришло сразу после смены кадра; кадры короче {state?.rotation?.minFrameSec ?? 10} с растягиваются до {state?.rotation?.minFrameSec ?? 10} с. Новый интервал начнёт действовать после доставки.
                  </p>
                  <button onClick={sendCurrent} disabled={sending || isStaging} className="bg-blue-600 text-white rounded py-2 text-sm font-medium disabled:opacity-50">
                    {sending ? 'Отправка...' : 'Отправить этот кадр'}
                  </button>
                  <button onClick={addToQueue} disabled={queue.length >= MAX_FRAMES} className={btn}>
                    Добавить в очередь кадров ({queue.length}/{MAX_FRAMES})
                  </button>
                  {sendResult && (
                    <div className={`text-xs px-2 py-1.5 rounded ${sendResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{sendResult.text}</div>
                  )}
                </div>
              </Section>
            </div>
          </div>

          {/* Queue */}
          <Section
            title={`Очередь кадров (${queue.length}/${MAX_FRAMES})`}
            right={
              <>
                <button onClick={loadCurrentFromServer} className={btn}>Загрузить текущие с сервера</button>
                <button onClick={() => { setRotationIdx(0); setRotating(!rotating); }} disabled={queue.length === 0} className={rotating ? 'text-xs px-2.5 py-1.5 rounded bg-orange-100 text-orange-700' : btn}>
                  {rotating ? 'Стоп превью' : 'Превью ротации'}
                </button>
                <button onClick={() => setQueue([])} disabled={queue.length === 0} className={btn}>Очистить</button>
                <button onClick={() => send(queue)} disabled={queue.length === 0 || sending || isStaging} className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white font-medium disabled:opacity-50">
                  Отправить очередь
                </button>
              </>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-neutral-500">Готовые сценарии:</span>
                {SCENARIOS.map((s) => (
                  <button key={s.id} title={s.hint} onClick={() => { setRotating(false); setQueue(s.build()); }} className={btn}>
                    {s.title}
                  </button>
                ))}
                <span className="text-[11px] text-neutral-400">заменяют очередь; потом «Отправить очередь»</span>
              </div>
              {queue.length === 0 && <div className="text-sm text-neutral-500">Очередь пуста. Добавьте текущий кадр или выберите сценарий. Кадры по кругу переключает сервер (минимум {state?.rotation?.minFrameSec ?? 10} с на кадр, точность ± несколько секунд; без связи кадр не меняется).</div>}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {queue.map((f, i) => (
                  <div key={f.key} className={`border rounded p-2 flex flex-col gap-1.5 ${previewFrame?.key === f.key ? 'ring-2 ring-orange-400' : ''}`}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium truncate">{i + 1}. {f.label}</span>
                      <span className="ml-auto flex gap-1">
                        <button onClick={() => moveQueued(i, -1)} className="text-neutral-500 hover:text-neutral-900" title="Раньше">←</button>
                        <button onClick={() => moveQueued(i, 1)} className="text-neutral-500 hover:text-neutral-900" title="Позже">→</button>
                        <button onClick={() => setQueue((q) => q.filter((x) => x.key !== f.key))} className="text-red-500" title="Удалить">✕</button>
                      </span>
                    </div>
                    <div className="flex items-stretch gap-1 self-start p-1 bg-neutral-800 rounded">
                      <MonoCanvas mono={f.mono} scale={0.5} />
                      <LedDot bar size={5} color={f.ledColor} brightness={f.ledBrightness} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      <select value={f.ledColor} onChange={(e) => updateQueued(f.key, { ledColor: e.target.value as LedColor })} className="border rounded px-0.5">
                        {LED_COLORS.map((c) => <option key={c} value={c}>{LED_COLOR_LABELS[c]}</option>)}
                      </select>
                      <select value={f.ledBrightness} onChange={(e) => updateQueued(f.key, { ledBrightness: e.target.value as LedBrightness })} className="border rounded px-0.5">
                        {LED_BRIGHTNESSES.map((b) => <option key={b} value={b}>{LED_BRIGHTNESS_LABELS[b]}</option>)}
                      </select>
                      <input type="number" min={1} max={86400} value={f.durationSec} title="Длительность, с"
                        onChange={(e) => updateQueued(f.key, { durationSec: Math.max(1, Math.min(86400, parseInt(e.target.value) || 1)) })}
                        className="border rounded px-1 w-14" />с
                      <label className="flex items-center gap-0.5" title="Звук"><input type="checkbox" checked={f.beep} onChange={(e) => updateQueued(f.key, { beep: e.target.checked })} />звук</label>
                      <input type="number" min={0} max={10} value={f.flashCount} title="Вспышки"
                        onChange={(e) => updateQueued(f.key, { flashCount: Math.max(0, Math.min(10, parseInt(e.target.value) || 0)) })}
                        className="border rounded px-1 w-10" />всп.
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {isOps && !isStaging && (
            <Section title="Частичное обновление: цена 0→100">
              <PartialRefreshTest deviceId={deviceId} state={state} onChange={() => loadState()} />
            </Section>
          )}

          {/* Device settings */}
          {state && (
            <Section title="Настройки устройства">
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => toggleSetting('autoUpdate')} className={`text-xs px-2.5 py-1.5 rounded ${state.autoUpdate ? 'bg-green-100 text-green-700' : 'bg-neutral-100'}`}>
                    Автообновление: {state.autoUpdate ? 'ВКЛ' : 'ВЫКЛ'}
                  </button>
                  <button onClick={() => toggleSetting('demoMode')} className={`text-xs px-2.5 py-1.5 rounded ${state.demoMode ? 'bg-purple-100 text-purple-700' : 'bg-neutral-100'}`}>
                    Демо-режим: {state.demoMode ? 'ВКЛ' : 'ВЫКЛ'}
                  </button>
                  {isOps && (
                    <button onClick={factoryReset} disabled={state.pendingFactoryReset} className="text-xs px-2.5 py-1.5 rounded bg-orange-100 text-orange-700 disabled:opacity-50">
                      {state.pendingFactoryReset ? 'Сброс ожидает heartbeat' : 'Сброс к заводским'}
                    </button>
                  )}
                </div>
                <ul className="text-[11px] text-neutral-500 list-disc ml-4 leading-snug">
                  <li>
                    OTA: при включённом автообновлении устройство проверяет прошивку через 60 с после загрузки и затем раз в час,
                    сравнивая свою версию с последней (сейчас v{latest}). Принудительного запуска обновления в API нет.
                  </li>
                  <li>Демо-режим применяется при следующем heartbeat с перезагрузкой; выключается только с точки доступа устройства.</li>
                  <li>Сброс к заводским отвязывает устройство и стирает его настройки при следующем heartbeat.</li>
                </ul>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
};

const GalleryTile: React.FC<{ id: string; title: string; hint: string; active: boolean; onClick: () => void }> = ({ id, title, hint, active, onClick }) => {
  const mono = useMemo(() => TEST_IMAGES.find((t) => t.id === id)!.render(), [id]);
  return (
    <button onClick={onClick} title={hint} className={`text-left border rounded p-1.5 flex flex-col gap-1 ${active ? 'border-blue-600 ring-1 ring-blue-600' : 'hover:border-neutral-400'}`}>
      <MonoCanvas mono={mono} scale={0.5} />
      <span className="text-xs font-medium">{title}</span>
      <span className="text-[10px] text-neutral-500 leading-tight line-clamp-2">{hint}</span>
    </button>
  );
};
