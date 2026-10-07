export interface EmbedProvider {
  id: string
  name: string
  /** Page height as a share of width (16 / 9 for video), or a fixed height in px. */
  aspect?: number
  height?: number
  match: (url: URL) => string | null
}

export interface ResolvedEmbed {
  provider: string
  name: string
  src: string
  aspect?: number
  height?: number
}

const bare = (host: string) => host.replace(/^www\./, '')

/** A provider whose address is `host` + a path pattern; `$1` ... fill `template`. */
function simple(
  id: string,
  name: string,
  hosts: string[],
  path: RegExp,
  template: string,
  size: { aspect?: number; height?: number } = { aspect: 16 / 9 }
): EmbedProvider {
  return {
    id,
    name,
    ...size,
    match(url) {
      if (!hosts.includes(bare(url.hostname))) return null
      const found = path.exec(url.pathname + url.search)
      if (!found) return null
      return template.replace(/\$(\d)/g, (_, index) => found[Number(index)] ?? '')
    },
  }
}

/** Providers that frame the page itself under another path or a query. */
function wrap(
  id: string,
  name: string,
  hosts: string[],
  build: (url: URL) => string,
  size: { aspect?: number; height?: number } = { aspect: 16 / 9 }
): EmbedProvider {
  return {
    id,
    name,
    ...size,
    match: (url) => (hosts.includes(bare(url.hostname)) ? build(url) : null),
  }
}

const tall = { height: 480 }

export const embedProviders: EmbedProvider[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    aspect: 16 / 9,
    match(url) {
      const host = bare(url.hostname)
      const id =
        host === 'youtu.be'
          ? url.pathname.slice(1)
          : ['youtube.com', 'm.youtube.com'].includes(host)
            ? url.pathname === '/watch'
              ? url.searchParams.get('v')
              : /^\/(?:embed|shorts|live)\/([\w-]{6,})/.exec(url.pathname)?.[1]
            : null
      return id && /^[\w-]{6,}$/.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : null
    },
  },
  simple('vimeo', 'Vimeo', ['vimeo.com'], /^\/(?:video\/)?(\d+)/, 'https://player.vimeo.com/video/$1'),
  simple('loom', 'Loom', ['loom.com'], /^\/(?:share|embed)\/(\w+)/, 'https://www.loom.com/embed/$1'),
  simple('wistia', 'Wistia', ['wistia.com', 'wi.st'], /\/(?:medias|embed)\/(\w+)/, 'https://fast.wistia.net/embed/iframe/$1'),
  simple('dailymotion', 'Dailymotion', ['dailymotion.com'], /^\/video\/(\w+)/, 'https://www.dailymotion.com/embed/video/$1'),
  simple('twitch', 'Twitch', ['twitch.tv'], /^\/videos\/(\d+)/, `https://player.twitch.tv/?video=$1&parent=${typeof location === 'undefined' ? 'localhost' : location.hostname}`),
  simple('spotify', 'Spotify', ['open.spotify.com'], /^\/(track|album|playlist|episode|show|artist)\/(\w+)/, 'https://open.spotify.com/embed/$1/$2', { height: 232 }),
  simple('soundcloud', 'SoundCloud', ['soundcloud.com'], /^(\/[\w-]+\/[\w-]+)$/, 'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com$1', { height: 166 }),
  simple('mixcloud', 'Mixcloud', ['mixcloud.com'], /^(\/[\w-]+\/[\w-]+\/)$/, 'https://www.mixcloud.com/widget/iframe/?feed=%2F$1', { height: 180 }),
  simple('bandcamp', 'Bandcamp', ['bandcamp.com'], /^\/EmbeddedPlayer\/(.+)$/, 'https://bandcamp.com/EmbeddedPlayer/$1', { height: 120 }),
  wrap('figma', 'Figma', ['figma.com'], (url) =>
    /^\/(file|design|proto|board)\//.test(url.pathname)
      ? `https://www.figma.com/embed?embed_host=dokudocs&url=${encodeURIComponent(url.origin + url.pathname + url.search)}`
      : ''
  ),
  simple('miro', 'Miro', ['miro.com'], /^\/app\/board\/([\w=-]+)/, 'https://miro.com/app/embed/$1/'),
  simple('lucid', 'Lucidchart', ['lucid.app', 'lucidchart.com'], /^\/(?:documents|lucidchart)\/(?:embedded\/)?([\w-]+)/, 'https://lucid.app/documents/embedded/$1'),
  simple('drawio', 'diagrams.net', ['viewer.diagrams.net', 'app.diagrams.net'], /^(.*)$/, 'https://viewer.diagrams.net$1'),
  simple('excalidraw', 'Excalidraw', ['excalidraw.com'], /^\/(#room=[\w,=-]+|#json=[\w,=-]+)$/, 'https://excalidraw.com/$1', tall),
  simple('whimsical', 'Whimsical', ['whimsical.com'], /\/([\w-]+)$/, 'https://whimsical.com/embed/$1'),
  simple('airtable', 'Airtable', ['airtable.com'], /^\/(?:embed\/)?(shr\w+|app\w+\/shr\w+)/, 'https://airtable.com/embed/$1', tall),
  simple('google-docs', 'Google Docs', ['docs.google.com'], /^\/document\/d\/([\w-]+)/, 'https://docs.google.com/document/d/$1/preview', tall),
  simple('google-sheets', 'Google Sheets', ['docs.google.com'], /^\/spreadsheets\/d\/([\w-]+)/, 'https://docs.google.com/spreadsheets/d/$1/preview', tall),
  simple('google-slides', 'Google Slides', ['docs.google.com'], /^\/presentation\/d\/([\w-]+)/, 'https://docs.google.com/presentation/d/$1/embed'),
  simple('google-forms', 'Google Forms', ['docs.google.com', 'forms.gle'], /^\/forms\/d\/e\/([\w-]+)/, 'https://docs.google.com/forms/d/e/$1/viewform?embedded=true', tall),
  simple('google-drive', 'Google Drive', ['drive.google.com'], /^\/file\/d\/([\w-]+)/, 'https://drive.google.com/file/d/$1/preview'),
  simple('google-calendar', 'Google Calendar', ['calendar.google.com'], /^\/calendar\/embed(.*)$/, 'https://calendar.google.com/calendar/embed$1', tall),
  wrap('google-maps', 'Google Maps', ['google.com', 'maps.google.com'], (url) =>
    url.pathname.startsWith('/maps/embed') ? url.href : ''
  , tall),
  simple('codepen', 'CodePen', ['codepen.io'], /^\/([\w-]+)\/(?:pen|full|details)\/(\w+)/, 'https://codepen.io/$1/embed/$2', tall),
  simple('codesandbox', 'CodeSandbox', ['codesandbox.io'], /^\/(?:s|p\/sandbox|embed)\/([\w-]+)/, 'https://codesandbox.io/embed/$1', tall),
  simple('jsfiddle', 'JSFiddle', ['jsfiddle.net'], /^\/([\w/]+?)\/?$/, 'https://jsfiddle.net/$1/embedded/', tall),
  simple('replit', 'Replit', ['replit.com'], /^\/@([\w-]+)\/([\w-]+)/, 'https://replit.com/@$1/$2?embed=true', tall),
  simple('stackblitz', 'StackBlitz', ['stackblitz.com'], /^\/edit\/([\w-]+)/, 'https://stackblitz.com/edit/$1?embed=1', tall),
  simple('gist', 'GitHub Gist', ['gist.github.com'], /^\/([\w-]+\/\w+)/, 'https://gist.github.com/$1.pibb', tall),
  simple('gitlab-snippet', 'GitLab Snippet', ['gitlab.com'], /^\/-\/snippets\/(\d+)/, 'https://gitlab.com/-/snippets/$1', tall),
  simple('typeform', 'Typeform', ['typeform.com'], /^\/to\/(\w+)/, 'https://form.typeform.com/to/$1', tall),
  simple('tally', 'Tally', ['tally.so'], /^\/(?:r|embed)\/(\w+)/, 'https://tally.so/embed/$1', tall),
  simple('calendly', 'Calendly', ['calendly.com'], /^\/([\w-]+(?:\/[\w-]+)?)$/, 'https://calendly.com/$1?embed_domain=dokudocs&embed_type=Inline', { height: 700 }),
  simple('cal', 'Cal.com', ['cal.com'], /^\/([\w-]+(?:\/[\w-]+)?)$/, 'https://cal.com/$1?embed=true', { height: 700 }),
  simple('trello', 'Trello', ['trello.com'], /^\/(b|c)\/(\w+)/, 'https://trello.com/$1/$2', tall),
  simple('notion', 'Notion', ['notion.so', 'notion.site'], /^(\/.+)$/, 'https://www.notion.so$1', tall),
  simple('pinterest', 'Pinterest', ['pinterest.com'], /^\/pin\/(\d+)/, 'https://assets.pinterest.com/ext/embed.html?id=$1', tall),
  simple('linkedin', 'LinkedIn', ['linkedin.com'], /^\/(?:embed\/)?feed\/update\/(urn:li:\w+:\d+)/, 'https://www.linkedin.com/embed/feed/update/$1', tall),
  simple('twitter', 'X (Twitter)', ['twitter.com', 'x.com'], /^\/\w+\/status\/(\d+)/, 'https://platform.twitter.com/embed/Tweet.html?id=$1', tall),
  simple('instagram', 'Instagram', ['instagram.com'], /^\/(p|reel)\/([\w-]+)/, 'https://www.instagram.com/$1/$2/embed', { height: 640 }),
  simple('tiktok', 'TikTok', ['tiktok.com'], /^\/@[\w.]+\/video\/(\d+)/, 'https://www.tiktok.com/embed/v2/$1', { height: 740 }),
  simple('reddit', 'Reddit', ['reddit.com'], /^(\/r\/\w+\/comments\/\w+.*)$/, 'https://embed.reddit.com$1', tall),
  simple('dropbox', 'Dropbox', ['dropbox.com'], /^\/(s|scl\/fi)\/(.+)$/, 'https://www.dropbox.com/$1/$2', tall),
  simple('invision', 'InVision', ['invisionapp.com'], /^\/(?:share|freehand)\/(\w+)/, 'https://projects.invisionapp.com/share/$1', tall),
  simple('berrycast', 'Berrycast', ['berrycast.com'], /^\/(?:conversations|recordings)\/([\w-]+)/, 'https://berrycast.com/conversations/$1/video-embed'),
  simple('grafana', 'Grafana', ['snapshots.raintank.io'], /^\/dashboard\/snapshot\/(\w+)/, 'https://snapshots.raintank.io/dashboard/snapshot/$1', tall),
  simple('pitch', 'Pitch', ['pitch.com'], /^\/(?:public|embed)\/([\w-]+)/, 'https://pitch.com/embed/$1'),
  simple('prezi', 'Prezi', ['prezi.com'], /^\/(?:v|view)\/([\w-]+)/, 'https://prezi.com/view/$1/embed', tall),
  simple('canva', 'Canva', ['canva.com'], /^\/design\/(\w+\/[\w-]+)\/view/, 'https://www.canva.com/design/$1/view?embed'),
  simple('descript', 'Descript', ['share.descript.com'], /^\/(?:view|embed)\/(\w+)/, 'https://share.descript.com/embed/$1'),
  simple('plantuml', 'PlantUML', ['plantuml.com'], /^\/plantuml\/(?:svg|png)\/(\w+)/, 'https://www.plantuml.com/plantuml/svg/$1', tall),
]

/** The embed an address opens, or null. Only https addresses of known providers qualify. */
export function resolveEmbed(address: string): ResolvedEmbed | null {
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  for (const provider of embedProviders) {
    const src = provider.match(url)
    if (src)
      return {
        provider: provider.id,
        name: provider.name,
        src,
        aspect: provider.aspect,
        height: provider.height,
      }
  }
  return null
}
