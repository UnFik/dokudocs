/** Side of the square picture sent to the server; the avatar is never shown larger than this. */
export const AVATAR_SIZE = 256
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']

function encode(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, 0.9)
  )
}

/**
 * Cuts the middle square out of the picture and shrinks it to AVATAR_SIZE. The
 * canvas drops the EXIF data on the way, and the result is far below the
 * server's limit. It throws for a file the browser cannot read as a picture.
 */
export async function resizeAvatar(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot resize pictures.')
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE
    )
    const webp = await encode(canvas, 'image/webp')
    // A browser that cannot write WebP hands back a PNG; JPEG is smaller.
    if (webp?.type === 'image/webp') return webp
    // JPEG has no transparency, so paint white behind the picture first.
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
    const jpeg = await encode(canvas, 'image/jpeg')
    if (!jpeg) throw new Error('This browser cannot resize pictures.')
    return jpeg
  } finally {
    bitmap.close()
  }
}
