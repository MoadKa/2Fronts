import { test, expect } from '@playwright/test'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!
const AUTOMATION_NAME = process.env.E2E_AUTOMATION_NAME ?? 'Invoice Sync'

test('customer requests and pays for an automation, admin delivers it', async ({ page, browser }) => {
  const customerEmail = `e2e-${Date.now()}@example.com`

  await page.goto('/')
  await page.getByText(AUTOMATION_NAME).click()

  await page.getByRole('button', { name: 'Log in / Sign up' }).click()
  await page.getByText('Need an account? Sign up').click()
  await page.getByLabel('Company name').fill('E2E Test Co')
  await page.getByLabel('Email').fill(customerEmail)
  await page.getByLabel('Password').fill('e2e-test-password-123')
  await page.getByRole('button', { name: 'Sign up' }).click()

  await page.getByRole('button', { name: 'Request this automation' }).click()
  await page.waitForURL(/checkout\.stripe\.com/)

  await page.getByLabel('Email').fill(customerEmail)
  await page.getByPlaceholder('1234 1234 1234 1234').fill('4242424242424242')
  await page.getByPlaceholder('MM / YY').fill('12/34')
  await page.getByPlaceholder('CVC').fill('123')
  await page.getByLabel('Cardholder name').fill('E2E Test')
  await page.getByRole('button', { name: /Pay/ }).click()

  await page.waitForURL(/\/checkout\/result\?status=success/)
  await expect(page.getByText('Payment received')).toBeVisible()

  await page.goto('/my-requests')
  await expect(page.getByText('paid')).toBeVisible({ timeout: 30_000 })

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/')
  await adminPage.getByRole('button', { name: 'Log in / Sign up' }).click()
  await adminPage.getByLabel('Email').fill(ADMIN_EMAIL)
  await adminPage.getByLabel('Password').fill(ADMIN_PASSWORD)
  await adminPage.getByRole('button', { name: 'Log in' }).click()

  await adminPage.goto('/admin/requests')
  await adminPage.getByRole('button', { name: 'Mark in_progress' }).click()
  await expect(adminPage.getByRole('button', { name: 'Mark delivered' })).toBeVisible()
  await adminPage.getByLabel('Delivery notes').fill('Connected to your Gmail and HubSpot.')
  await adminPage.getByRole('button', { name: 'Mark delivered' }).click()
  await adminContext.close()

  await page.goto('/my-requests')
  await expect(page.getByText('delivered')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Connected to your Gmail and HubSpot.')).toBeVisible()
})
