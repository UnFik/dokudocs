import { describe, expect, it } from 'vitest'
import { embedProviders, resolveEmbed } from './embeds'

describe('embeds', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'vimeo', 'https://player.vimeo.com/video/76979871'],
    ['https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'spotify', 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC'],
    ['https://www.loom.com/share/abc123def', 'loom', 'https://www.loom.com/embed/abc123def'],
    ['https://www.figma.com/file/abc/Name', 'figma', 'https://www.figma.com/embed?embed_host=dokudocs&url=https%3A%2F%2Fwww.figma.com%2Ffile%2Fabc%2FName'],
    ['https://codepen.io/user/pen/xyz', 'codepen', 'https://codepen.io/user/embed/xyz'],
    ['https://gist.github.com/user/0123abcd', 'gist', 'https://gist.github.com/user/0123abcd.pibb'],
  ])('knows %s', (url, provider, src) => {
    expect(resolveEmbed(url)).toMatchObject({ provider, src })
  })

  it('does not embed an address it does not know', () => {
    expect(resolveEmbed('https://example.com/video')).toBeNull()
    expect(resolveEmbed('javascript:alert(1)')).toBeNull()
    expect(resolveEmbed('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(resolveEmbed('https://evil.test/?u=https://youtu.be/dQw4w9WgXcQ')).toBeNull()
  })

  it('lists at least forty providers, each with a name', () => {
    expect(embedProviders.length).toBeGreaterThanOrEqual(40)
    for (const provider of embedProviders) expect(provider.name).toBeTruthy()
  })
})
