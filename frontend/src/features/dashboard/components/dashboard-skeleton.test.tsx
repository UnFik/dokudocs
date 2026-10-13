import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import {
  ProjectsSectionSkeleton,
  RecentSectionSkeleton,
} from './dashboard-skeleton'

const originalState = useDokudocsStore.getState()

afterEach(() => {
  useDokudocsStore.setState(originalState, true)
})

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient()
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

it('shows card placeholders in grid view under the real section heading', async () => {
  useDokudocsStore.setState({ viewMode: 'grid' })
  const screen = await renderWithClient(<RecentSectionSkeleton />)

  await expect
    .element(screen.getByRole('heading', { name: 'Recent Documents' }))
    .toBeVisible()
  expect(
    screen.container.querySelectorAll('[data-slot="skeleton"]').length
  ).toBeGreaterThan(4)
})

it('shows row placeholders in list view', async () => {
  useDokudocsStore.setState({ viewMode: 'list' })
  const screen = await renderWithClient(<RecentSectionSkeleton />)

  expect(screen.container.querySelector('.grid')).toBeNull()
  expect(
    screen.container.querySelectorAll('[data-slot="skeleton"]').length
  ).toBeGreaterThan(4)
})

it('shows project card placeholders', async () => {
  const screen = await renderWithClient(<ProjectsSectionSkeleton />)

  await expect
    .element(screen.getByRole('heading', { name: 'Projects' }))
    .toBeVisible()
  expect(
    screen.container.querySelectorAll('[data-slot="skeleton"]').length
  ).toBeGreaterThan(10)
})
