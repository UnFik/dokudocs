import '@/styles/index.css'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { ProjectCategoryFilter } from './project-category-filter'

describe('ProjectCategoryFilter', () => {
  const defaultProps = {
    projectId: 'test-project-1',
    categories: ['Authentication', 'Database', 'Frontend', 'DevOps'],
    selectedCategories: [],
    onToggleCategory: vi.fn(),
    onClearCategories: vi.fn(),
    docCountsByCategory: {
      Authentication: 5,
      Database: 3,
      Frontend: 8,
      DevOps: 2,
    },
    totalDocsCount: 18,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the filter button with "All Categories"', async () => {
    await render(<ProjectCategoryFilter {...defaultProps} />)

    const button = page.getByRole('button', { name: /All Categories/i }).first()
    await expect.element(button).toBeInTheDocument()
  })

  it('renders single selected category name on the filter button', async () => {
    await render(
      <ProjectCategoryFilter
        {...defaultProps}
        selectedCategories={['Authentication']}
      />
    )

    const button = page.getByRole('button', { name: /Authentication/i }).first()
    await expect.element(button).toBeInTheDocument()
  })

  it('renders count on filter button when multiple categories are selected', async () => {
    await render(
      <ProjectCategoryFilter
        {...defaultProps}
        selectedCategories={['Authentication', 'Frontend']}
      />
    )

    const button = page.getByRole('button', { name: /2 Categories/i })
    await expect.element(button).toBeInTheDocument()
  })

  it('opens the popover and displays search input and all categories', async () => {
    await render(<ProjectCategoryFilter {...defaultProps} />)

    const filterButton = page
      .getByRole('button', { name: /All Categories/i })
      .first()
    await userEvent.click(filterButton)

    const searchInput = page.getByPlaceholder('Search categories...')
    await expect.element(searchInput).toBeInTheDocument()

    const authOption = page.getByRole('option', { name: /Authentication/i })
    await expect.element(authOption).toBeInTheDocument()

    const devopsOption = page.getByRole('option', { name: /DevOps/i })
    await expect.element(devopsOption).toBeInTheDocument()
  })

  it('filters categories when typing in search input', async () => {
    await render(<ProjectCategoryFilter {...defaultProps} />)

    const filterButton = page
      .getByRole('button', { name: /All Categories/i })
      .first()
    await userEvent.click(filterButton)

    const searchInput = page.getByPlaceholder('Search categories...')
    await userEvent.fill(searchInput, 'Data')

    await expect
      .element(page.getByRole('option', { name: /Database/i }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('option', { name: /Authentication/i }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('option', { name: /Frontend/i }))
      .not.toBeInTheDocument()
  })

  it('shows empty message when search has no matching category', async () => {
    await render(<ProjectCategoryFilter {...defaultProps} />)

    const filterButton = page
      .getByRole('button', { name: /All Categories/i })
      .first()
    await userEvent.click(filterButton)

    const searchInput = page.getByPlaceholder('Search categories...')
    await userEvent.fill(searchInput, 'NonExistentTag')

    await expect
      .element(page.getByText('No categories found.'))
      .toBeInTheDocument()
  })

  it('calls onToggleCategory when clicking a category item in the dropdown', async () => {
    const onToggleCategory = vi.fn()
    await render(
      <ProjectCategoryFilter
        {...defaultProps}
        onToggleCategory={onToggleCategory}
      />
    )

    const filterButton = page
      .getByRole('button', { name: /All Categories/i })
      .first()
    await userEvent.click(filterButton)

    const authOption = page.getByRole('option', { name: /Authentication/i })
    await userEvent.click(authOption)

    expect(onToggleCategory).toHaveBeenCalledWith('Authentication')
  })

  it('calls onClearCategories when clicking "All Categories" in the dropdown', async () => {
    const onClearCategories = vi.fn()
    await render(
      <ProjectCategoryFilter
        {...defaultProps}
        selectedCategories={['Authentication']}
        onClearCategories={onClearCategories}
      />
    )

    const filterButton = page
      .getByRole('button', { name: /Authentication/i })
      .first()
    await userEvent.click(filterButton)

    const allCategoriesItem = page.getByRole('option', {
      name: /All Categories/i,
    })
    await userEvent.click(allCategoriesItem)

    expect(onClearCategories).toHaveBeenCalledTimes(1)
  })
})
