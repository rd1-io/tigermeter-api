// Device frame format: 384x168, 1 bit per pixel, MSB first, rows top to bottom,
// bit 1 = white, bit 0 = black (firmware Display::drawBitmap). 8064 bytes, base64 in the API.

export const WIDTH = 384;
export const HEIGHT = 168;
export const BITMAP_BYTES = (WIDTH * HEIGHT) / 8;

// One byte per pixel, 1 = black ink, 0 = white paper
export type Mono = Uint8Array;

export const blankMono = (ink = false): Mono => new Uint8Array(WIDTH * HEIGHT).fill(ink ? 1 : 0);

export function packMono(mono: Mono): string {
  const bytes = new Uint8Array(BITMAP_BYTES);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    if (!mono[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function unpackMono(b64: string): Mono {
  const mono = blankMono();
  try {
    const bin = atob(b64);
    if (bin.length !== BITMAP_BYTES) return mono;
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      mono[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1 ? 0 : 1;
    }
  } catch {}
  return mono;
}

export const invertMono = (mono: Mono): Mono => mono.map((v) => (v ? 0 : 1));

export type DitherMode = 'none' | 'floyd' | 'atkinson' | 'bayer';

export interface ToneOptions {
  threshold: number;   // 0..255, pixels darker than this become ink
  dither: DitherMode;
  invert: boolean;
  brightness: number;  // -100..100
  contrast: number;    // -100..100
}

export const DEFAULT_TONE: ToneOptions = { threshold: 128, dither: 'floyd', invert: false, brightness: 0, contrast: 0 };

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function grayFromRgba(rgba: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(WIDTH * HEIGHT);
  for (let i = 0; i < gray.length; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const lum = rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;
    gray[i] = lum * a + 255 * (1 - a); // transparent areas are paper
  }
  return gray;
}

export function grayToMono(input: Float32Array, opts: ToneOptions): Mono {
  const gray = new Float32Array(input);
  const c = (259 * (opts.contrast * 2.55 + 255)) / (255 * (259 - opts.contrast * 2.55));
  for (let i = 0; i < gray.length; i++) {
    let v = gray[i] + opts.brightness * 2.55;
    v = c * (v - 128) + 128;
    if (opts.invert) v = 255 - v;
    gray[i] = Math.max(0, Math.min(255, v));
  }

  const mono = blankMono();
  const t = opts.threshold;
  const spread = (x: number, y: number, err: number) => {
    if (x >= 0 && x < WIDTH && y < HEIGHT) gray[y * WIDTH + x] += err;
  };
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x;
      const old = gray[i];
      if (opts.dither === 'bayer') {
        // Threshold shifts the whole matrix so the slider still darkens/lightens the result
        const level = ((BAYER4[y & 3][x & 3] + 0.5) / 16) * 255 + (t - 128);
        mono[i] = old < level ? 1 : 0;
        continue;
      }
      const ink = old < t;
      mono[i] = ink ? 1 : 0;
      if (opts.dither === 'none') continue;
      const err = old - (ink ? 0 : 255);
      if (opts.dither === 'floyd') {
        spread(x + 1, y, (err * 7) / 16);
        spread(x - 1, y + 1, (err * 3) / 16);
        spread(x, y + 1, (err * 5) / 16);
        spread(x + 1, y + 1, err / 16);
      } else {
        const e = err / 8;
        spread(x + 1, y, e);
        spread(x + 2, y, e);
        spread(x - 1, y + 1, e);
        spread(x, y + 1, e);
        spread(x + 1, y + 1, e);
        spread(x, y + 2, e);
      }
    }
  }
  return mono;
}

export function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  return { canvas, ctx };
}

// Vector drawing (text, shapes) -> hard threshold, so anti-aliased edges don't turn into dither noise
export function monoFromDrawing(draw: (ctx: CanvasRenderingContext2D) => void, threshold = 128): Mono {
  const { ctx } = makeCanvas();
  draw(ctx);
  const gray = grayFromRgba(ctx.getImageData(0, 0, WIDTH, HEIGHT).data);
  return grayToMono(gray, { ...DEFAULT_TONE, threshold, dither: 'none' });
}

export type FitMode = 'contain' | 'cover' | 'stretch';

export function grayFromImage(img: CanvasImageSource & { width: number; height: number }, fit: FitMode, background: 'white' | 'black'): Float32Array {
  const { ctx } = makeCanvas();
  ctx.fillStyle = background === 'black' ? '#000' : '#fff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.imageSmoothingQuality = 'high';
  const iw = img.width;
  const ih = img.height;
  if (fit === 'stretch' || !iw || !ih) {
    ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
  } else {
    const scale = fit === 'contain' ? Math.min(WIDTH / iw, HEIGHT / ih) : Math.max(WIDTH / iw, HEIGHT / ih);
    const w = iw * scale;
    const h = ih * scale;
    ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
  }
  return grayFromRgba(ctx.getImageData(0, 0, WIDTH, HEIGHT).data);
}

export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать изображение'));
    };
    img.src = url;
  });
}

// Firmware drawBatteryIcon(5, 5), drawn over every frame while battery < 5%
export function withLowBatteryBadge(mono: Mono): Mono {
  const out = new Uint8Array(mono);
  const rect = (x: number, y: number, w: number, h: number, ink: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) out[yy * WIDTH + xx] = ink;
  };
  rect(2, 2, 33, 18, 1);
  rect(5, 5, 24, 1, 0);
  rect(5, 16, 24, 1, 0);
  rect(5, 5, 1, 12, 0);
  rect(28, 5, 1, 12, 0);
  rect(29, 8, 3, 6, 0);
  rect(7, 7, 2, 8, 0);
  return out;
}

export const EPAPER_PAPER: [number, number, number] = [0xf8, 0xf8, 0xf0];
export const EPAPER_INK: [number, number, number] = [0x1a, 0x1a, 0x1a];

export function drawMonoToCanvas(canvas: HTMLCanvasElement, mono: Mono) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(WIDTH, HEIGHT);
  for (let i = 0; i < mono.length; i++) {
    const [r, g, b] = mono[i] ? EPAPER_INK : EPAPER_PAPER;
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
