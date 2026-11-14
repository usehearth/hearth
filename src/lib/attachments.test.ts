import { describe, expect, it } from 'vitest';
import { AttachmentRefused, HearthAttachments, MAX_IMAGES } from './attachments';

const img = () => new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });
const caps = () => ({ image: true, embeddedContext: true });

describe('HearthAttachments', () => {
  it('takes images up to the limit', async () => {
    const a = new HearthAttachments(caps, () => MAX_IMAGES - 1);
    await expect(a.add({ file: img() })).resolves.toMatchObject({ type: 'image' });
  });
  it('refuses an image past the limit, with a reason', async () => {
    const a = new HearthAttachments(caps, () => MAX_IMAGES);
    await expect(a.add({ file: img() })).rejects.toBeInstanceOf(AttachmentRefused);
  });
  it('still takes text files when the images are full', async () => {
    const a = new HearthAttachments(caps, () => MAX_IMAGES);
    await expect(a.add({ file: new File(['x'], 'n.md', { type: 'text/markdown' }) })).resolves.toMatchObject({ type: 'document' });
  });
});
