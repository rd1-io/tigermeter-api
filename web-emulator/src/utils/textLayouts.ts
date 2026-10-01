import { HEIGHT, Mono, WIDTH, invertMono, monoFromDrawing } from './bitmap';

export type TextLayout = 'value' | 'sidebar' | 'single' | 'multiline';
export type FontFamily = 'sans' | 'serif' | 'mono';
export type TextAlign = 'left' | 'center' | 'right';

export interface TextSpec {
  layout: TextLayout;
  title: string;
  value: string;
  subtitle: string;
  tag: string;
  body: string;
  font: FontFamily;
  bold: boolean;
  size: number;       // main text size in px
  align: TextAlign;
  autoFit: boolean;   // shrink main text until it fits the width
  invert: boolean;
}

export const TEXT_LAYOUTS: { id: TextLayout; label: string; hint: string }[] = [
  { id: 'value', label: 'Заголовок + значение', hint: 'Подпись сверху, крупное значение, строка снизу — как экран тикера' },
  { id: 'sidebar', label: 'Плашка слева', hint: 'Чёрная плашка 135 px с тегом и две строки справа — как системные экраны прошивки' },
  { id: 'single', label: 'Одна строка', hint: 'Одна крупная строка по центру' },
  { id: 'multiline', label: 'Многострочный', hint: 'Произвольный текст, перенос по словам' },
];

export const DEFAULT_TEXT: TextSpec = {
  layout: 'value',
  title: 'BTC / USD',
  value: '67 420 $',
  subtitle: '▲ +2.41% за 24 ч',
  tag: 'OK',
  body: 'Тестовое сообщение для TigerMeter.\nВторая строка текста.',
  font: 'sans',
  bold: true,
  size: 56,
  align: 'center',
  autoFit: true,
  invert: false,
};

const FAMILIES: Record<FontFamily, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

const font = (spec: TextSpec, size: number, bold = spec.bold) => `${bold ? 'bold ' : ''}${size}px ${FAMILIES[spec.font]}`;

const fitSize = (ctx: CanvasRenderingContext2D, spec: TextSpec, text: string, size: number, maxWidth: number, bold?: boolean) => {
  let s = size;
  ctx.font = font(spec, s, bold);
  while (spec.autoFit && s > 8 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = font(spec, s, bold);
  }
  return s;
};

const alignedX = (align: TextAlign, left: number, right: number) =>
  align === 'left' ? left : align === 'right' ? right : (left + right) / 2;

const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
};

export function renderText(spec: TextSpec): Mono {
  const pad = 8;
  const mono = monoFromDrawing((ctx) => {
    ctx.textBaseline = 'middle';
    ctx.textAlign = spec.align;
    if (spec.layout === 'value') {
      const x = alignedX(spec.align, pad, WIDTH - pad);
      ctx.font = font(spec, 18);
      if (spec.title) ctx.fillText(spec.title, x, 20);
      fitSize(ctx, spec, spec.value, spec.size, WIDTH - pad * 2);
      ctx.fillText(spec.value, x, HEIGHT / 2 + 4);
      ctx.font = font(spec, 16, false);
      if (spec.subtitle) ctx.fillText(spec.subtitle, x, HEIGHT - 20);
    } else if (spec.layout === 'sidebar') {
      ctx.fillRect(0, 0, 135, HEIGHT);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      fitSize(ctx, spec, spec.tag, 32, 135 - pad * 2, true);
      ctx.fillText(spec.tag, 135 / 2, HEIGHT / 2);
      ctx.fillStyle = '#000';
      ctx.textAlign = 'left';
      fitSize(ctx, spec, spec.value, Math.min(spec.size, 40), WIDTH - 150 - pad);
      ctx.fillText(spec.value, 150, 70);
      ctx.font = font(spec, 16, false);
      if (spec.subtitle) ctx.fillText(spec.subtitle, 150, 104);
    } else if (spec.layout === 'single') {
      fitSize(ctx, spec, spec.value, spec.size, WIDTH - pad * 2);
      ctx.fillText(spec.value, alignedX(spec.align, pad, WIDTH - pad), HEIGHT / 2);
    } else {
      ctx.font = font(spec, spec.size);
      let size = spec.size;
      let lines = wrap(ctx, spec.body, WIDTH - pad * 2);
      while (spec.autoFit && size > 8 && lines.length * size * 1.2 > HEIGHT - pad * 2) {
        size -= 1;
        ctx.font = font(spec, size);
        lines = wrap(ctx, spec.body, WIDTH - pad * 2);
      }
      const lh = size * 1.2;
      const top = (HEIGHT - lines.length * lh) / 2 + lh / 2;
      lines.forEach((line, i) => ctx.fillText(line, alignedX(spec.align, pad, WIDTH - pad), top + i * lh));
    }
  });
  return spec.invert ? invertMono(mono) : mono;
}
