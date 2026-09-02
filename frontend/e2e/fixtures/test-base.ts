import { test as baseTest, expect } from '@playwright/test'
import { LoginPage } from '../pages/login.page'
import { DashboardPage } from '../pages/dashboard.page'
import { DocEditorPage } from '../pages/doc-editor.page'
import { TasksPage } from '../pages/tasks.page'
import { UsersPage } from '../pages/users.page'
import { SettingsPage } from '../pages/settings.page'
import { setAuthenticatedState, setupAuthMockRoutes } from './auth.fixture'

type AppFixtures = {
  loginPage: LoginPage
  dashboardPage: DashboardPage
  docEditorPage: DocEditorPage
  tasksPage: TasksPage
  usersPage: UsersPage
  settingsPage: SettingsPage
  authedTest: void
}

export const test = baseTest.extend<AppFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page))
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page))
  },
  docEditorPage: async ({ page }, use) => {
    await use(new DocEditorPage(page))
  },
  tasksPage: async ({ page }, use) => {
    await use(new TasksPage(page))
  },
  usersPage: async ({ page }, use) => {
    await use(new UsersPage(page))
  },
  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page))
  },
  authedTest: [
    async ({ page }, use) => {
      await setAuthenticatedState(page)
      await use()
    },
    { auto: false },
  ],
})

export { expect, setupAuthMockRoutes, setAuthenticatedState }
