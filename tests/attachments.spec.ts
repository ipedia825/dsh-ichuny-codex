import { describe, expect, it } from 'vitest'

import { fileHandleText, imageDataUrl } from '../src/adapter.js'

describe('attachment projections', () => {
  it('encodes normalized image bytes as a Codex data URL', async () => {
    const bytes = Uint8Array.from([0, 1, 2, 3])
    const store = {
      readImageRequest: async () => ({ data: bytes, mediaType: 'image/png' as const }),
    }
    await expect(imageDataUrl(store as never, {
      attachmentId: 'image-1' as never,
      mediaType: 'image/png',
      bytes: 4,
      width: 1,
      height: 1,
    }, undefined)).resolves.toBe('data:image/png;base64,AAECAw==')
  })

  it('keeps file metadata and read-only path in the model handle', () => {
    expect(fileHandleText({ attachmentId: 'file-1', name: 'notes.txt', bytes: 12 }, 'C:\\readonly\\notes.txt'))
      .toContain('notes.txt, 12 bytes, read-only path: C:\\readonly\\notes.txt')
  })
})
