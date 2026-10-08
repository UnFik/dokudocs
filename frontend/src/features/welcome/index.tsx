import { Link, useSearch } from '@tanstack/react-router'
import { Logo } from '@/assets/logo'
import markdownLight from '@/assets/landing/markdown-light.webp'
import markdownDark from '@/assets/landing/markdown-dark.webp'
import dbmlLight from '@/assets/landing/dbml-light.webp'
import dbmlDark from '@/assets/landing/dbml-dark.webp'
import mermaidDark from '@/assets/landing/mermaid-dark.webp'

const features = [
  {
    type: 'dbml',
    title: 'Lihat skema sambil mengeditnya.',
    description:
      'Tulis DBML di editor dan lihat hubungan antar tabel pada kanvas di sampingnya.',
    light: dbmlLight,
    dark: dbmlDark,
    alt: 'Editor DBML dan kanvas relasi tabel dalam satu layar',
  },
  {
    type: 'mermaid',
    title: 'Bahas alur sistem dalam diagram.',
    description:
      'Tulis diagram Mermaid di dokumen dan bagikan halaman yang perlu ditinjau.',
    dark: mermaidDark,
    alt: 'Diagram Mermaid alur dokumen di DokuDocs',
  },
] as const

function ProductImage({
  alt,
  dark,
  light,
}: {
  alt: string
  dark: string
  light?: string
}) {
  return (
    <figure className='overflow-hidden rounded-md border border-border bg-card'>
      {light && <img src={light} alt={alt} className='dark:hidden' />}
      <img
        src={dark}
        alt={light ? '' : alt}
        aria-hidden={light ? true : undefined}
        className={light ? 'hidden dark:block' : 'block'}
      />
    </figure>
  )
}

export function WelcomePage() {
  const { redirect } = useSearch({ from: '/' })

  return (
    <main lang='id' className='min-h-svh bg-background text-foreground'>
      <header className='border-b border-border'>
        <nav
          aria-label='Navigasi utama'
          className='mx-auto flex min-h-16 max-w-6xl items-center justify-between px-5 sm:px-8'
        >
          <Link
            to='/'
            aria-label='DokuDocs, halaman awal'
            className='inline-flex min-h-11 items-center gap-2 rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
          >
            <Logo />
            <span>Dokudocs</span>
          </Link>
          <div className='flex items-center gap-2 sm:gap-4'>
            <a
              href='#dokumen'
              className='hidden min-h-11 items-center rounded-sm px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-flex'
            >
              Dokumen
            </a>
            <a
              href='#kolaborasi'
              className='hidden min-h-11 items-center rounded-sm px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-flex'
            >
              Kolaborasi
            </a>
            <Link
              to='/sign-in'
              search={{ redirect }}
              className='inline-flex min-h-11 items-center rounded-sm border border-input px-3 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
            >
              Masuk
            </Link>
          </div>
        </nav>
      </header>

      <section className='mx-auto grid max-w-6xl gap-8 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-12 lg:py-24'>
        <div className='max-w-lg'>
          <p className='mb-4 font-mono text-xs text-muted-foreground'>
            markdown · dbml · mermaid
          </p>
          <h1 className='text-balance text-[28px] leading-tight font-semibold tracking-tight'>
            Dokumen teknis yang tumbuh bersama proyek.
          </h1>
          <p className='mt-5 max-w-md text-base leading-7 text-muted-foreground'>
            Tulis catatan, skema data, dan diagram sistem dalam satu workspace.
            Tim bisa mengedit dokumen bersama, melihat revisi, lalu membagikan
            halaman yang perlu ditinjau.
          </p>
          <div className='mt-7 flex flex-wrap items-center gap-3'>
            <Link
              to='/sign-up'
              className='inline-flex min-h-11 items-center justify-center rounded-sm bg-signal px-4 text-sm font-medium text-signal-foreground hover:bg-signal/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
            >
              Buat akun
            </Link>
            <span className='text-sm text-muted-foreground'>
              Sudah punya akun?{' '}
              <Link
                to='/sign-in'
                search={{ redirect }}
                className='min-h-11 rounded-sm py-3 text-foreground underline underline-offset-4 hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
              >
                Masuk
              </Link>
            </span>
          </div>
        </div>
        <ProductImage
          light={markdownLight}
          dark={markdownDark}
          alt='Dokumen teknis dibuka di editor Markdown DokuDocs'
        />
      </section>

      <section
        id='dokumen'
        className='border-y border-border bg-card/50'
      >
        <div className='mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20'>
          <div className='max-w-lg'>
            <p className='mb-3 font-mono text-xs text-muted-foreground'>
              Bentuk dokumen
            </p>
            <h2 className='text-xl leading-tight font-semibold tracking-tight'>
              Tulis dalam format yang dipakai proyekmu.
            </h2>
          </div>
          <div className='mt-8 grid gap-5 md:grid-cols-2'>
            {features.map((feature) => (
              <article key={feature.type} className='min-w-0'>
                <ProductImage {...feature} />
                <p className='mt-4 font-mono text-xs text-muted-foreground'>
                  {feature.type}
                </p>
                <h3 className='mt-2 text-base font-medium'>{feature.title}</h3>
                <p className='mt-2 max-w-prose text-sm leading-6 text-muted-foreground'>
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id='kolaborasi'
        className='mx-auto grid max-w-6xl gap-8 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-2 lg:items-center'
      >
        <div className='max-w-lg'>
          <p className='mb-3 font-mono text-xs text-muted-foreground'>
            Ruang kerja bersama
          </p>
          <h2 className='text-xl leading-tight font-semibold tracking-tight'>
            Perubahan tercatat. Akses tetap di tanganmu.
          </h2>
          <p className='mt-4 text-sm leading-6 text-muted-foreground'>
            Beri izin per halaman dan tinjau perubahan ketika seseorang
            mengajukan saran. Tautan publik hanya memberi akses baca.
          </p>
        </div>
        <div className='min-w-0 border-t border-border lg:border-t-0 lg:border-l lg:pl-8'>
          <p className='py-4 text-sm leading-6 text-muted-foreground lg:py-3'>
            <span className='mr-3 font-mono text-xs text-foreground'>
              markdown
            </span>
            Perubahan tersimpan sebagai revisi yang bisa ditinjau kembali.
          </p>
          <p className='border-t border-border py-4 text-sm leading-6 text-muted-foreground lg:py-3'>
            <span className='mr-3 font-mono text-xs text-foreground'>
              saran
            </span>
            Ajukan edit untuk dibaca pemilik dokumen.
          </p>
          <p className='border-t border-border py-4 text-sm leading-6 text-muted-foreground lg:py-3'>
            <span className='mr-3 font-mono text-xs text-foreground'>
              akses
            </span>
            Atur izin per halaman atau bagikan tautan baca.
          </p>
        </div>
      </section>

      <footer className='border-t border-border'>
        <div className='mx-auto flex max-w-6xl flex-col gap-4 px-5 py-7 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8'>
          <Link
            to='/'
            className='inline-flex min-h-11 items-center gap-2 rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
          >
            <Logo className='size-5' />
            Dokudocs
          </Link>
          <p className='text-muted-foreground'>Markdown, DBML, dan Mermaid.</p>
          <Link
            to='/sign-up'
            className='inline-flex min-h-11 items-center rounded-sm text-foreground underline underline-offset-4 hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
          >
            Buat akun
          </Link>
        </div>
      </footer>
    </main>
  )
}
