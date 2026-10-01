import { DEFAULT_TONE, HEIGHT, Mono, WIDTH, blankMono, grayToMono, monoFromDrawing } from './bitmap';

export interface TestImage {
  id: string;
  title: string;
  hint: string;
  render: () => Mono;
}

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const centerText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number) => {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
};

// Box behind a label so it stays readable over patterns
const label = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 14) => {
  ctx.font = `bold ${size}px ${SANS}`;
  const w = ctx.measureText(text).width + 10;
  const h = size + 8;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x - w / 2) + 0.5, Math.round(y - h / 2) + 0.5, Math.round(w), Math.round(h));
  ctx.fillStyle = '#000';
  centerText(ctx, text, x, y + 1);
};

const checkerboard = (cell: number): Mono => {
  const mono = blankMono();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      mono[y * WIDTH + x] = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) as 0 | 1;
    }
  }
  return mono;
};

const gradient = (): Mono => {
  // Top: Floyd–Steinberg, middle: Bayer, bottom: 10 flat steps (dithered) — compares ditherers on the panel
  const gray = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const t = x / (WIDTH - 1);
      gray[y * WIDTH + x] = y < 112 ? 255 * t : 255 * (Math.floor(t * 10) / 9 > 1 ? 1 : Math.floor(t * 10) / 9);
    }
  }
  const floyd = grayToMono(gray, { ...DEFAULT_TONE, dither: 'floyd' });
  const bayer = grayToMono(gray, { ...DEFAULT_TONE, dither: 'bayer' });
  const mono = blankMono();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x;
      mono[i] = y < 56 ? floyd[i] : y < 112 ? bayer[i] : floyd[i];
    }
  }
  for (let x = 0; x < WIDTH; x++) {
    mono[56 * WIDTH + x] = 1;
    mono[112 * WIDTH + x] = 1;
  }
  const labels = monoFromDrawing((ctx) => {
    label(ctx, 'Floyd–Steinberg', 70, 28, 12);
    label(ctx, 'Bayer 4×4', 314, 84, 12);
    label(ctx, '10 ступеней', 192, 140, 12);
  });
  // Labels are drawn on white boxes, so paste the boxes over the pattern
  const boxes = monoFromDrawing((ctx) => {
    ctx.font = `bold 12px ${SANS}`;
    for (const [text, x, y] of [['Floyd–Steinberg', 70, 28], ['Bayer 4×4', 314, 84], ['10 ступеней', 192, 140]] as const) {
      const w = ctx.measureText(text).width + 10;
      ctx.fillRect(x - w / 2, y - 10, w, 20);
    }
  });
  for (let i = 0; i < mono.length; i++) if (boxes[i]) mono[i] = labels[i];
  return mono;
};

const tigerLogo = (ctx: CanvasRenderingContext2D) => {
  // Round badge with tiger stripes and a wordmark
  const cx = 84;
  const cy = 84;
  const r = 68;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = '#000';
  for (let i = -3; i <= 3; i++) {
    const y = cy + i * 18;
    ctx.beginPath();
    ctx.moveTo(cx - r, y - 6);
    ctx.quadraticCurveTo(cx - r / 2, y + 4, cx - 10, y - 2);
    ctx.lineTo(cx - r, y + 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + r, y - 6);
    ctx.quadraticCurveTo(cx + r / 2, y + 4, cx + 10, y - 2);
    ctx.lineTo(cx + r, y + 6);
    ctx.fill();
  }
  ctx.restore();
  ctx.font = `900 46px ${SANS}`;
  centerText(ctx, 'TM', cx, cy + 3);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 40px ${SANS}`;
  ctx.fillText('Tiger', 170, 78);
  ctx.fillText('Meter', 170, 118);
  ctx.font = `14px ${SANS}`;
  ctx.fillText('e-paper · 384×168', 172, 142);
};

const tickerChart = (ctx: CanvasRenderingContext2D) => {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `bold 18px ${SANS}`;
  ctx.fillText('BTC / USD', 10, 24);
  ctx.textAlign = 'right';
  ctx.font = `bold 14px ${SANS}`;
  ctx.fillText('▲ +2.41%', 374, 24);
  ctx.textAlign = 'left';
  ctx.font = `800 44px ${SANS}`;
  ctx.fillText('67 420 $', 10, 72);
  // Deterministic random walk so the image is the same every time
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts: [number, number][] = [];
  let v = 0.5;
  for (let i = 0; i <= 60; i++) {
    v = Math.min(0.95, Math.max(0.05, v + (rand() - 0.45) * 0.12));
    pts.push([10 + (i / 60) * 364, 158 - v * 70]);
  }
  ctx.beginPath();
  ctx.moveTo(10, 160);
  pts.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(374, 160);
  ctx.closePath();
  ctx.save();
  ctx.clip();
  for (let x = 0; x < WIDTH; x += 4) ctx.fillRect(x, 80, 1, 90);
  ctx.restore();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.fillRect(10, 160, 364, 1);
};

export const TEST_IMAGES: TestImage[] = [
  {
    id: 'edges',
    title: 'Края и рамка',
    hint: 'Рамка 1 px по самому краю, вторая на 4 px, уголки и координаты — видно ли всё поле 384×168',
    render: () =>
      monoFromDrawing((ctx) => {
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1);
        ctx.strokeRect(4.5, 4.5, WIDTH - 9, HEIGHT - 9);
        const L = 24;
        for (const [x, y, dx, dy] of [[8, 8, 1, 1], [WIDTH - 9, 8, -1, 1], [8, HEIGHT - 9, 1, -1], [WIDTH - 9, HEIGHT - 9, -1, -1]]) {
          ctx.fillRect(Math.min(x, x + dx * L), y, L, 3 * dy || 3);
          ctx.fillRect(x, Math.min(y, y + dy * L), 3 * dx || 3, L);
        }
        ctx.font = `bold 12px ${MONO}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText('0,0', 14, 14);
        ctx.textAlign = 'right';
        ctx.fillText('383,0', WIDTH - 14, 14);
        ctx.textBaseline = 'bottom';
        ctx.fillText('383,167', WIDTH - 14, HEIGHT - 14);
        ctx.textAlign = 'left';
        ctx.fillText('0,167', 14, HEIGHT - 14);
        ctx.font = `bold 28px ${SANS}`;
        centerText(ctx, '384 × 168', WIDTH / 2, HEIGHT / 2 - 10);
        ctx.font = `14px ${SANS}`;
        centerText(ctx, 'ВЕРХ ↑', WIDTH / 2, 22);
        centerText(ctx, 'рамка 1 px · отступ 4 px', WIDTH / 2, HEIGHT / 2 + 18);
      }),
  },
  {
    id: 'grid',
    title: 'Сетка и линейки',
    hint: 'Сетка 8 px, крупные деления каждые 32 px с подписями, перекрестие в центре — для выравнивания',
    render: () =>
      monoFromDrawing((ctx) => {
        for (let x = 0; x < WIDTH; x += 8) ctx.fillRect(x, 0, 1, x % 32 === 0 ? HEIGHT : 4);
        for (let y = 0; y < HEIGHT; y += 8) ctx.fillRect(0, y, y % 32 === 0 ? WIDTH : 4, 1);
        for (let x = 0; x < WIDTH; x += 8) for (let y = 0; y < HEIGHT; y += 8) ctx.fillRect(x, y, 1, 1);
        ctx.fillRect(WIDTH - 1, 0, 1, HEIGHT);
        ctx.fillRect(0, HEIGHT - 1, WIDTH, 1);
        ctx.font = `9px ${MONO}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        for (let x = 32; x < WIDTH; x += 64) ctx.fillText(String(x), x + 2, 2);
        for (let y = 32; y < HEIGHT; y += 32) ctx.fillText(String(y), 2, y + 2);
        ctx.fillRect(WIDTH / 2 - 20, HEIGHT / 2 - 1, 40, 2);
        ctx.fillRect(WIDTH / 2 - 1, HEIGHT / 2 - 20, 2, 40);
      }),
  },
  { id: 'checker8', title: 'Шахматка 8 px', hint: 'Равномерность заливки и чёткость границ', render: () => checkerboard(8) },
  { id: 'checker1', title: 'Шахматка 1 px', hint: 'Самый мелкий узор: проверка резкости и гостинга', render: () => checkerboard(1) },
  {
    id: 'lines',
    title: 'Полосы 1 px',
    hint: 'Слева вертикальные, справа горизонтальные линии через пиксель — смещение строк и остаточное изображение',
    render: () => {
      const mono = blankMono();
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          mono[y * WIDTH + x] = x < WIDTH / 2 ? ((x & 1) as 0 | 1) : ((y & 1) as 0 | 1);
        }
      }
      return mono;
    },
  },
  { id: 'gradient', title: 'Градиент (дизеринг)', hint: 'Плавный переход серого в 1 бит: Floyd–Steinberg, Bayer и ступени', render: gradient },
  {
    id: 'bigtext',
    title: 'Крупный текст',
    hint: 'Кириллица, латиница и цифры разного кегля',
    render: () =>
      monoFromDrawing((ctx) => {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `900 64px ${SANS}`;
        ctx.fillText('0123456789', 8, 62);
        ctx.font = `bold 34px ${SANS}`;
        ctx.fillText('Привет, Тигр!', 8, 104);
        ctx.font = `24px ${SANS}`;
        ctx.fillText('The quick brown fox · ЁЖЩЮЯ', 8, 136);
        ctx.font = `14px ${MONO}`;
        ctx.fillText('mono 14px: !@#$%^&*()[]{} 1Il| 0Oo', 8, 160);
      }),
  },
  {
    id: 'fontsizes',
    title: 'Лесенка кеглей',
    hint: 'Минимально читаемый размер шрифта: 8–40 px',
    render: () =>
      monoFromDrawing((ctx) => {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        let y = 2;
        for (const size of [8, 10, 12, 14, 16, 20, 24, 32]) {
          ctx.font = `${size}px ${SANS}`;
          ctx.fillText(`${size}px Тест шрифта Test 123`, 4, y);
          y += size + 3;
        }
      }),
  },
  { id: 'logo', title: 'Логотип', hint: 'Иллюстрация с заливками, кривыми и текстом', render: () => monoFromDrawing(tigerLogo) },
  { id: 'ticker', title: 'Тикер с графиком', hint: 'Типичный экран интегратора: курс, изменение, график со штриховкой', render: () => monoFromDrawing(tickerChart) },
  {
    id: 'halves',
    title: 'Половины ч/б',
    hint: 'Левая половина чёрная, правая белая, текст в обеих — контраст и инверсия',
    render: () =>
      monoFromDrawing((ctx) => {
        ctx.fillRect(0, 0, WIDTH / 2, HEIGHT);
        ctx.font = `bold 30px ${SANS}`;
        ctx.fillStyle = '#fff';
        centerText(ctx, 'БЕЛЫЙ', WIDTH / 4, HEIGHT / 2);
        ctx.fillStyle = '#000';
        centerText(ctx, 'ЧЁРНЫЙ', (WIDTH * 3) / 4, HEIGHT / 2);
      }),
  },
  { id: 'black', title: 'Чёрный экран', hint: 'Полная заливка: равномерность и остаточное изображение после смены', render: () => blankMono(true) },
  { id: 'white', title: 'Белый экран', hint: 'Очистка панели', render: () => blankMono(false) },
];
