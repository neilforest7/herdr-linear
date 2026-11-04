import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif']]);

export async function downloadLinearImage(src, extract) {
  const url = new URL(src);
  if (url.protocol !== 'https:' || url.hostname !== 'uploads.linear.app' || url.port || url.username || url.password) throw new Error('invalid image URL');
  const result = await extract(`![image](${url.href.replaceAll('(', '%28').replaceAll(')', '%29')})`);
  const block = result?.content?.find(item => item.type === 'image');
  const extension = IMAGE_TYPES.get(block?.mimeType);
  if (result?.isError || !extension || typeof block.data !== 'string' || block.data.length > Math.ceil(MAX_IMAGE_SIZE / 3) * 4) throw new Error('invalid image result');
  const bytes = Buffer.from(block.data, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_SIZE) throw new Error('image too large');
  const relative = `data/linear/images/${createHash('sha256').update(url.pathname).digest('hex')}.${extension}`;
  const appHome = process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app');
  const directory = join(appHome, 'data/linear/images');
  const destination = join(appHome, relative);
  const temp = join(directory, `.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temp, destination);
  } finally { await unlink(temp).catch(() => {}); }
  return relative;
}

function issueLink(tag) {
  const attr = name => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
  const label = (attr('label') || 'Issue').replace(/[\\\[\]]/g, '\\$&');
  try {
    const url = new URL((attr('href') || '').replaceAll('&amp;', '&'));
    if (url.protocol !== 'https:' || url.hostname !== 'linear.app' || url.port || url.username || url.password) throw new Error('invalid issue URL');
    url.search = ''; url.hash = '';
    return `[${label}](${url.href.replace(/[()]/g, c => c === '(' ? '%28' : '%29')})`;
  } catch {
    return label;
  }
}

async function imagePart(tag, loadImage) {
  let title = '';
  try {
    const json = tag.replace(/^<linear-image\b[^>]*>/i, '').replace(/<\/linear-image\s*>$/i, '');
    const attrs = JSON.parse(json).attrs;
    title = typeof attrs?.title === 'string' ? attrs.title : '';
    if (typeof attrs?.src !== 'string') throw new Error('missing image');
    const path = await loadImage(attrs.src);
    const dimension = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    return { type: 'image', path, width: dimension(attrs.width), height: dimension(attrs.height), title };
  } catch {
    return { type: 'image', error: '图片暂时无法加载', title };
  }
}

function codeRanges(raw) {
  const ranges = [];
  let fence = null;
  for (const match of raw.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)(?:\n|$)/gm)) {
    if (!fence) fence = { marker: match[1], start: match.index };
    else if (match[1][0] === fence.marker[0] && match[1].length >= fence.marker.length && !match[2].trim()) {
      ranges.push([fence.start, match.index + match[0].length]); fence = null;
    }
  }
  if (fence) ranges.push([fence.start, raw.length]);
  for (const match of raw.matchAll(/^(?: {4}|\t).*$/gm)) ranges.push([match.index, match.index + match[0].length]);
  const covered = index => ranges.some(([start, end]) => index >= start && index < end);
  const ticks = [...raw.matchAll(/`+/g)];
  for (let i = 0; i < ticks.length; i++) {
    if (covered(ticks[i].index)) continue;
    const end = ticks.findIndex((tick, j) => j > i && tick[0].length === ticks[i][0].length && !covered(tick.index));
    if (end >= 0) { ranges.push([ticks[i].index, ticks[end].index + ticks[end][0].length]); i = end; }
  }
  return ranges;
}

export async function prepareDescription(raw, loadImage) {
  if (typeof raw !== 'string' || !raw) return [];
  const parts = [];
  let markdown = '';
  const append = text => {
    let cursor = 0;
    const tags = /<issue\b[^>]*\/\s*>|<linear-image\b(?:[^>]*>[\s\S]*?(?:<\/linear-image\s*>|$)|[^>]*$)/gi;
    for (const match of text.matchAll(tags)) {
      markdown += text.slice(cursor, match.index);
      if (/^<issue\b/i.test(match[0])) markdown += issueLink(match[0]);
      else {
        if (markdown) parts.push({ type: 'markdown', text: markdown });
        markdown = '';
        parts.push(imagePart(match[0], loadImage));
      }
      cursor = match.index + match[0].length;
    }
    markdown += text.slice(cursor);
  };
  const ranges = [];
  for (const [start, end] of codeRanges(raw).sort((a,b) => a[0]-b[0])) {
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1],end);
    else ranges.push([start,end]);
  }
  let cursor = 0;
  for (const [start,end] of ranges) {
    append(raw.slice(cursor,start));
    markdown += raw.slice(start,end);
    cursor = end;
  }
  append(raw.slice(cursor));
  if (markdown) parts.push({ type: 'markdown', text: markdown });
  return Promise.all(parts);
}
