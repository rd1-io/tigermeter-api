import React, { useState, useEffect, useRef } from "react";
import { apiClient } from "../api/client";
import { DisplayFrame, DisplayFramesPayload, DEFAULT_FRAME, LedColor, LedBrightness } from "../types/display";

const WIDTH = 384;
const HEIGHT = 168;
const SCALE = 2;

const LED_COLORS: LedColor[] = ['green', 'red', 'blue', 'yellow', 'cyan', 'magenta', 'white', 'rainbow', 'off'];
const LED_BRIGHTNESSES: LedBrightness[] = ['low', 'mid', 'high', 'off'];

// Pack RGBA image data (WxH) into 1-bit bitmap, MSB-first per byte, 1=white, 0=black
function packBitmap(pixels: boolean[][]): string {
  const bytes: number[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        if (x + b < WIDTH && pixels[y][x + b]) {
          byte |= (1 << (7 - b));
        }
      }
      bytes.push(byte);
    }
  }
  return btoa(String.fromCharCode(...bytes));
}

// Decode base64 bitmap to boolean pixels
function unpackBitmap(b64: string): boolean[][] {
  const pixels: boolean[][] = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(false));
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array([...binary].map(c => c.charCodeAt(0)));
    if (bytes.length !== WIDTH * HEIGHT / 8) return pixels;
    let idx = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x += 8) {
        const byte = bytes[idx++];
        for (let b = 0; b < 8; b++) {
          if (x + b < WIDTH) {
            pixels[y][x + b] = !!(byte & (1 << (7 - b)));
          }
        }
      }
    }
  } catch {}
  return pixels;
}

// Floyd-Steinberg dithering on RGBA image data
function ditherTo1Bit(rgba: Uint8ClampedArray): boolean[][] {
  const gray = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0, idx = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++, idx++) {
      const i = (y * WIDTH + x) * 4;
      gray[idx] = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
    }
  }
  const pixels: boolean[][] = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(false));
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const idx = y * WIDTH + x;
      const old = gray[idx];
      const newVal = old > 128 ? 255 : 0;
      pixels[y][x] = newVal === 255;
      const err = old - newVal;
      if (x + 1 < WIDTH) gray[y * WIDTH + (x + 1)] += err * 7 / 16;
      if (y + 1 < HEIGHT) {
        if (x > 0) gray[(y + 1) * WIDTH + (x - 1)] += err * 3 / 16;
        gray[(y + 1) * WIDTH + x] += err * 5 / 16;
        if (x + 1 < WIDTH) gray[(y + 1) * WIDTH + (x + 1)] += err * 1 / 16;
      }
    }
  }
  return pixels;
}

// Simple 5x7 bitmap font (ASCII 32..126) for the text tool
const BITMAP_FONT: Record<string, number[]> = {
  ' ': [0,0,0,0,0], '!': [0x00,0x00,0x5F,0x00,0x00], '"': [0x00,0x07,0x00,0x07,0x00], '#': [0x14,0x7F,0x14,0x7F,0x14],
  '$': [0x24,0x2A,0x7F,0x2A,0x12], '%': [0x23,0x13,0x08,0x64,0x62], '&': [0x36,0x49,0x55,0x22,0x50], "'": [0x00,0x05,0x03,0x00,0x00],
  '(': [0x00,0x1C,0x22,0x41,0x00], ')': [0x00,0x41,0x22,0x1C,0x00], '*': [0x08,0x2A,0x1C,0x2A,0x08], '+': [0x08,0x08,0x3E,0x08,0x08],
  ',': [0x00,0x50,0x30,0x00,0x00], '-': [0x08,0x08,0x08,0x08,0x08], '.': [0x00,0x60,0x60,0x00,0x00], '/': [0x20,0x10,0x08,0x04,0x02],
  '0': [0x3E,0x51,0x49,0x45,0x3E], '1': [0x00,0x42,0x7F,0x40,0x00], '2': [0x42,0x61,0x51,0x49,0x46], '3': [0x21,0x41,0x45,0x4B,0x31],
  '4': [0x18,0x14,0x12,0x7F,0x10], '5': [0x27,0x45,0x45,0x45,0x39], '6': [0x3C,0x4A,0x49,0x49,0x30], '7': [0x01,0x71,0x09,0x05,0x03],
  '8': [0x36,0x49,0x49,0x49,0x36], '9': [0x06,0x49,0x49,0x29,0x1E], ':': [0x00,0x36,0x36,0x00,0x00], ';': [0x00,0x56,0x36,0x00,0x00],
  '<': [0x00,0x08,0x14,0x22,0x41], '=': [0x14,0x14,0x14,0x14,0x14], '>': [0x41,0x22,0x14,0x08,0x00], '?': [0x02,0x01,0x51,0x09,0x06],
  '@': [0x32,0x49,0x79,0x41,0x3E], 'A': [0x7E,0x11,0x11,0x11,0x7E], 'B': [0x7F,0x49,0x49,0x49,0x36], 'C': [0x3E,0x41,0x41,0x41,0x22],
  'D': [0x7F,0x41,0x41,0x22,0x1C], 'E': [0x7F,0x49,0x49,0x49,0x41], 'F': [0x7F,0x09,0x09,0x01,0x01], 'G': [0x3E,0x41,0x49,0x49,0x7A],
  'H': [0x7F,0x08,0x08,0x08,0x7F], 'I': [0x00,0x41,0x7F,0x41,0x00], 'J': [0x20,0x40,0x41,0x3F,0x01], 'K': [0x7F,0x08,0x14,0x22,0x41],
  'L': [0x7F,0x40,0x40,0x40,0x40], 'M': [0x7F,0x02,0x04,0x02,0x7F], 'N': [0x7F,0x04,0x08,0x10,0x7F], 'O': [0x3E,0x41,0x41,0x41,0x3E],
  'P': [0x7F,0x09,0x09,0x09,0x06], 'Q': [0x3E,0x41,0x51,0x21,0x5E], 'R': [0x7F,0x09,0x19,0x29,0x46], 'S': [0x46,0x49,0x49,0x49,0x31],
  'T': [0x01,0x01,0x7F,0x01,0x01], 'U': [0x3F,0x40,0x40,0x40,0x3F], 'V': [0x1F,0x20,0x40,0x20,0x1F], 'W': [0x7F,0x20,0x18,0x20,0x7F],
  'X': [0x63,0x14,0x08,0x14,0x63], 'Y': [0x03,0x04,0x78,0x04,0x03], 'Z': [0x61,0x51,0x49,0x45,0x43], '[': [0x00,0x00,0x7F,0x41,0x41],
  '\\': [0x02,0x04,0x08,0x10,0x20], ']': [0x41,0x41,0x7F,0x00,0x00], '^': [0x04,0x02,0x01,0x02,0x04], '_': [0x40,0x40,0x40,0x40,0x40],
  '`': [0x00,0x01,0x02,0x04,0x00], 'a': [0x20,0x54,0x54,0x54,0x78], 'b': [0x7F,0x48,0x44,0x44,0x38], 'c': [0x38,0x44,0x44,0x44,0x20], 'd': [0x38,0x44,0x44,0x48,0x7F],
  'e': [0x38,0x54,0x54,0x54,0x18], 'f': [0x08,0x7E,0x09,0x01,0x02], 'g': [0x0C,0x52,0x52,0x52,0x3E], 'h': [0x7F,0x08,0x04,0x04,0x78],
  'i': [0x00,0x44,0x7D,0x40,0x00], 'j': [0x20,0x40,0x44,0x3D,0x00], 'k': [0x7F,0x10,0x28,0x44,0x00], 'l': [0x00,0x41,0x7F,0x40,0x00],
  'm': [0x7C,0x04,0x18,0x04,0x78], 'n': [0x7C,0x08,0x04,0x04,0x78], 'o': [0x38,0x44,0x44,0x44,0x38], 'p': [0x7C,0x14,0x14,0x14,0x08],
  'q': [0x08,0x14,0x14,0x18,0x7C], 'r': [0x7C,0x08,0x04,0x04,0x08], 's': [0x48,0x54,0x54,0x54,0x20], 't': [0x04,0x3F,0x44,0x40,0x20],
  'u': [0x3C,0x40,0x40,0x20,0x7C], 'v': [0x1C,0x20,0x40,0x20,0x1C], 'w': [0x3C,0x40,0x30,0x40,0x3C], 'x': [0x44,0x28,0x10,0x28,0x44],
  'y': [0x0C,0x50,0x50,0x50,0x3C], 'z': [0x44,0x64,0x54,0x4C,0x44], '{': [0x00,0x08,0x36,0x41,0x00], '|': [0x00,0x00,0x7F,0x00,0x00],
  '}': [0x00,0x41,0x36,0x08,0x00], '~': [0x02,0x01,0x02,0x04,0x02],
};

// Draw line (Bresenham) on boolean grid
function drawLineOnPixels(pixels: boolean[][], x0: number, y0: number, x1: number, y1: number, set: boolean) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 >= 0 && x0 < WIDTH && y0 >= 0 && y0 < HEIGHT) pixels[y0][x0] = set;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Draw rect outline on boolean grid
function drawRectOnPixels(pixels: boolean[][], x0: number, y0: number, x1: number, y1: number, set: boolean) {
  const [lx, rx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ty, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  for (let x = lx; x <= rx; x++) {
    if (ty >= 0 && ty < HEIGHT && x >= 0 && x < WIDTH) pixels[ty][x] = set;
    if (by >= 0 && by < HEIGHT && x >= 0 && x < WIDTH) pixels[by][x] = set;
  }
  for (let y = ty; y <= by; y++) {
    if (lx >= 0 && lx < WIDTH && y >= 0 && y < HEIGHT) pixels[y][lx] = set;
    if (rx >= 0 && rx < WIDTH && y >= 0 && y < HEIGHT) pixels[y][rx] = set;
  }
}

// Draw text with 5x7 font starting at (x,y), returns new x
function drawTextOnPixels(pixels: boolean[][], x: number, y: number, text: string) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = BITMAP_FONT[ch];
    if (!glyph) { cx += 6; continue; }
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 7; row++) {
        const px = cx + col, py = y + row;
        if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT && (glyph[col] & (1 << row))) {
          pixels[py][px] = true;
        }
      }
    }
    cx += 6; // 5px glyph + 1px spacing
  }
}

interface FrameEditorProps {
  deviceId: string;
  scope: string;
}

export const FrameEditor: React.FC<FrameEditorProps> = ({ deviceId, scope }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pixels, setPixels] = useState<boolean[][]>(() => Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(false)));
  const [frames, setFrames] = useState<DisplayFrame[]>([{ ...DEFAULT_FRAME }]);
  const [activeFrameIdx, setActiveFrameIdx] = useState(0);
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [status, setStatus] = useState("");
  const [previewRunning, setPreviewRunning] = useState(false);
  const [tool, setTool] = useState<'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'text'>('pencil');
  const isDrawing = useRef(false);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState("");

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(WIDTH, HEIGHT);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 4;
        const c = pixels[y][x] ? 255 : 0;
        img.data[i] = c;
        img.data[i + 1] = c;
        img.data[i + 2] = c;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [pixels]);

  // Sync active frame to canvas
  useEffect(() => {
    const frame = frames[activeFrameIdx];
    if (frame && frame.bitmap) {
      setPixels(unpackBitmap(frame.bitmap));
    } else {
      setPixels(Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(false)));
    }
  }, [activeFrameIdx, frames]);

  const getCanvasPos = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / SCALE),
      y: Math.floor((e.clientY - rect.top) / SCALE),
    };
  };

  const applyTool = (x: number, y: number) => {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    setPixels(prev => {
      const next = prev.map(row => [...row]);
      if (tool === 'pencil') next[y][x] = true;
      else if (tool === 'eraser') next[y][x] = false;
      else if (tool === 'fill') {
        // Flood fill
        const target = next[y][x];
        const color = !target;
        if (target === color) return next;
        const stack = [[x, y]];
        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          if (cx < 0 || cx >= WIDTH || cy < 0 || cy >= HEIGHT) continue;
          if (next[cy][cx] !== target) continue;
          next[cy][cx] = color;
          stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
        }
      }
      return next;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (previewRunning) return;
    const { x, y } = getCanvasPos(e);
    if (tool === 'line' || tool === 'rect') {
      anchorRef.current = { x, y };
      isDrawing.current = true;
      return;
    }
    if (tool === 'text') {
      setPixels(prev => {
        const next = prev.map(row => [...row]);
        drawTextOnPixels(next, x, y, textInput || "TEXT");
        return next;
      });
      return;
    }
    isDrawing.current = true;
    applyTool(x, y);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing.current || previewRunning) return;
    const { x, y } = getCanvasPos(e);
    if ((tool === 'line' || tool === 'rect') && anchorRef.current) {
      const anchor = anchorRef.current;
      setPixels(prev => {
        const next = prev.map(row => [...row]);
        if (tool === 'line') drawLineOnPixels(next, anchor.x, anchor.y, x, y, true);
        else drawRectOnPixels(next, anchor.x, anchor.y, x, y, true);
        return next;
      });
      return;
    }
    applyTool(x, y);
  };

  const handleMouseUp = () => { isDrawing.current = false; anchorRef.current = null; };

  const handleClear = () => {
    setPixels(Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(false)));
  };

  const handleInvert = () => {
    setPixels(prev => prev.map(row => row.map(p => !p)));
  };

  // Import PNG
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
      const rgba = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
      setPixels(ditherTo1Bit(rgba));
    };
    img.src = URL.createObjectURL(file);
  };

  // Sync bitmap from canvas to current frame
  const syncFrameBitmap = () => {
    setFrames(prev => {
      const next = [...prev];
      next[activeFrameIdx] = { ...next[activeFrameIdx], bitmap: packBitmap(pixels) };
      return next;
    });
  };

  // Update frame field
  const updateFrame = (idx: number, field: string, value: any) => {
    setFrames(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addFrame = () => {
    if (frames.length >= 8) return;
    syncFrameBitmap();
    setFrames(prev => [...prev, { ...DEFAULT_FRAME }]);
    setActiveFrameIdx(frames.length);
  };

  const deleteFrame = (idx: number) => {
    if (frames.length <= 1) return;
    syncFrameBitmap();
    setFrames(prev => prev.filter((_, i) => i !== idx));
    if (activeFrameIdx >= idx) setActiveFrameIdx(Math.max(0, activeFrameIdx - 1));
  };

  const moveFrame = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= frames.length) return;
    syncFrameBitmap();
    setFrames(prev => {
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
    if (activeFrameIdx === idx) setActiveFrameIdx(newIdx);
  };

  // Load current from server
  const handleLoadCurrent = async () => {
    if (scope !== 'ops') return;
    setStatus("Loading...");
    try {
      const resp = await apiClient.getDeviceDisplay(deviceId);
      if (resp.ok) {
        const data: DisplayFramesPayload = await resp.json();
        setFrames(data.frames.length > 0 ? data.frames : [{ ...DEFAULT_FRAME }]);
        setRefreshInterval(data.refreshInterval);
        setActiveFrameIdx(0);
        setStatus("Loaded");
      } else {
        setStatus("No frames yet");
      }
    } catch (e: any) {
      setStatus("Error: " + e.message);
    }
  };

  // Save to server
  const handleSave = async () => {
    syncFrameBitmap();
    setStatus("Saving...");
    try {
      const payload: DisplayFramesPayload = {
        frames: frames.filter(f => f.bitmap.length > 0),
        refreshInterval,
      };
      const hash = await apiClient.computeDisplayHash(payload);
      const resp = await apiClient.setDisplayFrames(deviceId, payload);
      if (resp.ok) {
        const data = await resp.json();
        setStatus(`Saved! v${data.displayVersion} — ${hash.slice(0, 16)}`);
      } else {
        const err = await resp.json().catch(() => ({}));
        setStatus(err.message || `Error ${resp.status}`);
      }
    } catch (e: any) {
      setStatus("Error: " + e.message);
    }
  };

  // Preview rotation
  useEffect(() => {
    if (!previewRunning) return;
    let idx = 0;
    const activeFrames = frames.filter(f => f.bitmap.length > 0);
    if (activeFrames.length === 0) { setPreviewRunning(false); return; }

    const show = () => {
      const f = activeFrames[idx];
      setPixels(unpackBitmap(f.bitmap));
      idx = (idx + 1) % activeFrames.length;
      const nextF = activeFrames[idx];
      const dur = (nextF.durationSec || 5) * 1000;
      timeout = setTimeout(show, dur);
    };
    let timeout = setTimeout(show, 0);
    return () => clearTimeout(timeout);
  }, [previewRunning, frames]);

  const frame = frames[activeFrameIdx] || DEFAULT_FRAME;

  return (
    <div className="bg-white rounded-md border shadow-sm p-4">
      <div className="flex gap-6">
        {/* Canvas */}
        <div className="flex-shrink-0">
          <div className="flex gap-1 mb-2 flex-wrap">
            {(['pencil', 'eraser', 'fill', 'line', 'rect'] as const).map(t => (
              <button key={t} onClick={() => setTool(t)} className={`text-xs px-2 py-1 rounded ${tool === t ? 'bg-blue-600 text-white' : 'bg-neutral-100'}`}>
                {t === 'pencil' ? '✏️ Draw' : t === 'eraser' ? '🧹 Erase' : t === 'fill' ? '🪣 Fill' : t === 'line' ? '📏 Line' : '▭ Rect'}
              </button>
            ))}
            <button onClick={() => setTool('text')} className={`text-xs px-2 py-1 rounded ${tool === 'text' ? 'bg-blue-600 text-white' : 'bg-neutral-100'}`}>
              🔤 Text
            </button>
            <button onClick={handleClear} className="text-xs px-2 py-1 rounded bg-neutral-100">Clear</button>
            <button onClick={handleInvert} className="text-xs px-2 py-1 rounded bg-neutral-100">Invert</button>
            <label className="text-xs px-2 py-1 rounded bg-neutral-100 cursor-pointer">
              📷 Import PNG
              <input type="file" accept="image/png,image/jpeg" onChange={handleImport} className="hidden" />
            </label>
          </div>
          {tool === 'text' && (
            <div className="flex gap-2 mb-2 items-center">
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Text (click canvas to place)"
                className="flex-1 border rounded px-2 py-1 text-xs font-mono"
                maxLength={60}
              />
              <span className="text-[11px] text-neutral-500">5x7 font, uppercase</span>
            </div>
          )}
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ width: WIDTH * SCALE, height: HEIGHT * SCALE, imageRendering: 'pixelated', border: '1px solid #ddd', cursor: previewRunning ? 'default' : 'crosshair' }}
          />
          <div className="text-xs text-neutral-500 mt-1">384×168 — {WIDTH * HEIGHT / 8}B packed</div>
        </div>

        {/* Frame list + controls */}
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {frames.map((f, i) => (
              <span key={i} className={`text-xs px-2 py-1 rounded cursor-pointer flex items-center gap-1 ${
                i === activeFrameIdx ? 'bg-blue-600 text-white' : 'bg-neutral-100'
              }`}>
                <span onClick={() => { syncFrameBitmap(); setActiveFrameIdx(i); }}>Frame {i + 1}</span>
                <button onClick={() => moveFrame(i, -1)} className="text-[10px]">◀</button>
                <button onClick={() => moveFrame(i, 1)} className="text-[10px]">▶</button>
                <button onClick={() => deleteFrame(i)} className="text-[10px] text-red-500">✕</button>
              </span>
            ))}
            {frames.length < 8 && (
              <button onClick={addFrame} className="text-xs px-2 py-1 rounded bg-green-100 text-green-700">+ Add</button>
            )}
          </div>

          {/* Frame settings */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <label className="text-xs text-neutral-500">Duration (sec)</label>
              <input type="number" min={1} max={86400} value={frame.durationSec}
                onChange={e => updateFrame(activeFrameIdx, 'durationSec', parseInt(e.target.value) || 30)}
                className="w-full border rounded px-2 py-1" />
            </div>
            <div>
              <label className="text-xs text-neutral-500">LED Color</label>
              <select value={frame.ledColor} onChange={e => updateFrame(activeFrameIdx, 'ledColor', e.target.value)}
                className="w-full border rounded px-2 py-1">
                {LED_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500">LED Brightness</label>
              <select value={frame.ledBrightness} onChange={e => updateFrame(activeFrameIdx, 'ledBrightness', e.target.value)}
                className="w-full border rounded px-2 py-1">
                {LED_BRIGHTNESSES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={frame.beep || false}
                  onChange={e => updateFrame(activeFrameIdx, 'beep', e.target.checked)} />
                Beep
              </label>
              <div>
                <label className="text-xs text-neutral-500">Flash</label>
                <input type="number" min={0} max={10} value={frame.flashCount || 0}
                  onChange={e => updateFrame(activeFrameIdx, 'flashCount', parseInt(e.target.value) || 0)}
                  className="w-16 border rounded px-2 py-1" />
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 mt-2">
            <div>
              <label className="text-xs text-neutral-500">Refresh Interval (sec)</label>
              <input type="number" min={10} max={3600} value={refreshInterval}
                onChange={e => setRefreshInterval(parseInt(e.target.value) || 60)}
                className="w-20 border rounded px-2 py-1 ml-2" />
            </div>
            <button onClick={() => setPreviewRunning(!previewRunning)}
              className={`text-xs px-3 py-1.5 rounded ${previewRunning ? 'bg-orange-100 text-orange-700' : 'bg-neutral-100'}`}>
              {previewRunning ? '⏹ Stop Preview' : '▶ Preview'}
            </button>
            {scope === 'ops' && (
              <button onClick={handleLoadCurrent} className="text-xs px-3 py-1.5 rounded bg-neutral-100">📥 Load</button>
            )}
            <button onClick={handleSave} className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white font-medium">💾 Save to Device</button>
          </div>

          {status && <div className="text-xs text-neutral-600">{status}</div>}
        </div>
      </div>
    </div>
  );
};