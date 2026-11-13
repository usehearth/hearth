// Attachments for a message: images, and text or code files as embedded context. Read in the window when sent and
// passed to the server in the prompt (ACP image and resource blocks); Hearth keeps nothing on disk.
// What a server takes comes from its `promptCapabilities`. Images are re-encoded when the server would refuse them:
// formats other than PNG, JPEG and WebP become PNG, and big ones are scaled down (long side 2048 px) as JPEG.
import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from '@assistant-ui/react';

export const MAX_IMAGES = 4;
const IMAGE_OK = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024; // the server takes 5 MB; leave room
const MAX_SIDE = 2048;
export const MAX_TEXT_BYTES = 512 * 1024;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonc|ya?ml|toml|ini|cfg|conf|env\.example|log|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|bat|sql|graphql|proto|vue|svelte|lua|r|dart|scala|ex|exs|erl|clj|hs|ml|tf|dockerfile|gitignore)$/i;

export const isTextFile = (f: { name: string; type: string }) =>
  f.type.startsWith('text/') || /^application\/(json|xml|x-yaml|yaml|toml|javascript|typescript|x-sh|sql)/.test(f.type) || TEXT_EXT.test(f.name) || /^(Dockerfile|Makefile|README|LICENSE)$/i.test(f.name);

export interface Caps { image: boolean; embeddedContext: boolean }

export class AttachmentRefused extends Error {}

let n = 0;
const id = () => `att-${Date.now().toString(36)}-${(n++).toString(36)}`;

export class HearthAttachments implements AttachmentAdapter {
  // Any file can be picked or dropped: one the server can't take is refused with a reason, never dropped silently.
  accept = '*';
  /** caps: what the connected server takes (undefined until connected: assume images and text). */
  constructor(private caps: () => Caps | undefined) {}

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    const caps = this.caps() ?? { image: true, embeddedContext: true };
    if (file.type.startsWith('image/')) {
      if (!caps.image) throw new AttachmentRefused("This server doesn't take images.");
      return { id: id(), type: 'image', name: file.name || 'image', contentType: file.type, file, status: { type: 'requires-action', reason: 'composer-send' } };
    }
    if (isTextFile(file)) {
      if (!caps.embeddedContext) throw new AttachmentRefused("This server doesn't take files.");
      if (file.size > MAX_TEXT_BYTES) throw new AttachmentRefused(`${file.name} is too big (text files up to ${MAX_TEXT_BYTES / 1024} KB).`);
      return { id: id(), type: 'document', name: file.name, contentType: file.type || 'text/plain', file, status: { type: 'requires-action', reason: 'composer-send' } };
    }
    throw new AttachmentRefused(`${file.name || 'That file'} can't be sent: the server takes images and text or code files. Put other files in the project folder and mention them.`);
  }

  async send(a: PendingAttachment): Promise<CompleteAttachment> {
    if (a.type === 'image') {
      const { dataUrl, mimeType } = await fitImage(a.file);
      return { ...a, contentType: mimeType, status: { type: 'complete' }, content: [{ type: 'image', image: dataUrl, filename: a.name }] };
    }
    const bytes = new Uint8Array(await a.file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    // A `file` part with a text type: the adapter's conversion sends it as an embedded text resource.
    return { ...a, status: { type: 'complete' }, content: [{ type: 'file', data: btoa(bin), mimeType: textMime(a.contentType), filename: a.name }] };
  }

  async remove() { /* nothing kept */ }
}

const textMime = (t: string | undefined) => (t && (t.startsWith('text/') || t.startsWith('application/')) ? t : 'text/plain');

/** The image as a data URL the server takes: PNG/JPEG/WebP within the size limits, re-encoded only when needed. */
export async function fitImage(file: Blob): Promise<{ dataUrl: string; mimeType: string }> {
  const okType = IMAGE_OK.has(file.type);
  let bitmap: ImageBitmap | null = null;
  try { bitmap = await createImageBitmap(file); } catch { /* unreadable: send as is if the type is fine */ }
  const big = bitmap ? Math.max(bitmap.width, bitmap.height) > MAX_SIDE : false;
  if (okType && file.size <= MAX_IMAGE_BYTES && !big) return { dataUrl: await readDataUrl(file), mimeType: file.type };
  if (!bitmap) throw new AttachmentRefused("This image can't be read.");
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  // Photos (big) as JPEG; small non-native formats (GIF, BMP, SVG...) as PNG to keep sharp edges.
  for (const [type, q] of (big || file.size > MAX_IMAGE_BYTES ? [['image/jpeg', 0.88], ['image/jpeg', 0.75], ['image/jpeg', 0.6]] : [['image/png', 1], ['image/jpeg', 0.85]]) as [string, number][]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
    if (blob && blob.size <= MAX_IMAGE_BYTES) return { dataUrl: await readDataUrl(blob), mimeType: type };
  }
  throw new AttachmentRefused('This image is too big to send, even scaled down.');
}

const readDataUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error ?? new Error('read failed'));
  r.readAsDataURL(b);
});
