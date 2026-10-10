import { expect, it } from 'vitest'
import { AVATAR_SIZE, resizeAvatar } from './resize-avatar'

async function picture(width: number, height: number, type = 'image/png') {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#336699'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#ffcc00'
  context.fillRect(width / 4, height / 4, width / 2, height / 2)
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), type)
  )
  return new File([blob], 'me', { type })
}

it.each([
  ['wide', 600, 300],
  ['tall', 300, 700],
  ['small', 64, 64],
])('cuts a %s picture to a square of the avatar size', async (_name, w, h) => {
  const result = await resizeAvatar(await picture(w, h))
  expect(['image/webp', 'image/jpeg']).toContain(result.type)
  expect(result.size).toBeLessThan(512 * 1024)
  const bitmap = await createImageBitmap(result)
  expect([bitmap.width, bitmap.height]).toEqual([AVATAR_SIZE, AVATAR_SIZE])
})

it('keeps the middle of the picture when it cuts the edges off', async () => {
  const result = await resizeAvatar(await picture(600, 300))
  const bitmap = await createImageBitmap(result)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')!
  context.drawImage(bitmap, 0, 0)
  const [r, g, b] = context.getImageData(
    AVATAR_SIZE / 2,
    AVATAR_SIZE / 2,
    1,
    1
  ).data
  // The yellow square is in the middle; the blue frame is at the edge.
  expect(r).toBeGreaterThan(200)
  expect(b).toBeLessThan(100)
  const edge = context.getImageData(2, 2, 1, 1).data
  expect(edge[2]).toBeGreaterThan(edge[0])
  expect(g).toBeGreaterThan(150)
})

it('refuses a file that is not a picture', async () => {
  await expect(
    resizeAvatar(new File(['not a picture'], 'a.png', { type: 'image/png' }))
  ).rejects.toThrow()
})
