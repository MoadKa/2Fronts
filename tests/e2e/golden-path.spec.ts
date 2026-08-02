import { test, expect, type Page } from '@playwright/test'

// Scope credential fields to the dialog: the footer carries a support mailto
// link labelled "Email", which makes a bare getByLabel('Email') ambiguous.
async function register(page: Page, email: string) {
  await page.getByRole('button', { name: 'Sign in / Register' }).click()
  const dialog = page.locator('.modal-content')
  await dialog.getByText('No account yet? Register').click()
  await dialog.getByLabel('Company name').fill('E2E Test Co')
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Password').fill('e2e-test-password-123')
  await dialog.getByRole('button', { name: 'Register', exact: true }).click()
}

// The catalogue row the home page promotes. Seeded as "KI-Buchungsassistent";
// these specs drive the English entry point, so the English name is the default.
const AUTOMATION_NAME = process.env.E2E_AUTOMATION_NAME ?? 'AI Booking Concierge'
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD

// The paid leg redirects into Stripe Checkout and types a card number. The only
// Stripe key this repo carries is a LIVE one, and a live key must never meet a
// test card in an automated run — so that half stays off until someone points
// the local edge functions at an sk_test_ key and sets this flag.
const STRIPE_TEST_MODE = process.env.E2E_STRIPE_TEST_MODE === '1'

// /en is the deterministic entry: it forces English regardless of the language
// the browser advertises, so the selectors below don't depend on the runner's
// locale the way the previous version of this file silently did.
test('a visitor browses the offer, registers, and reaches the paywall', async ({ page }) => {
  const customerEmail = `e2e-${Date.now()}@example.com`

  await page.goto('/en')

  // The offer card is the home page's one route into the funnel.
  await page.getByRole('link', { name: new RegExp(AUTOMATION_NAME, 'i') }).click()
  await expect(page).toHaveURL(/\/automations\/[0-9a-f-]+$/)

  // Signed out, the detail page withholds the CTA and asks for an account.
  await expect(page.getByText('Sign in to set up your setter.')).toBeVisible()

  await register(page, customerEmail)

  // Registered, the same page now offers the paid action. This is the last
  // assertion that holds without Stripe.
  await expect(page.getByRole('button', { name: 'Set up your setter' })).toBeVisible({
    timeout: 15_000,
  })
})

test('customer pays for the setter and admin delivers it', async ({ page, browser }) => {
  test.skip(
    !STRIPE_TEST_MODE,
    'Needs local edge functions on an sk_test_ Stripe key; set E2E_STRIPE_TEST_MODE=1.',
  )
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'Needs E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD for the delivery half.',
  )

  const customerEmail = `e2e-${Date.now()}@example.com`

  await page.goto('/en')
  await page.getByRole('link', { name: new RegExp(AUTOMATION_NAME, 'i') }).click()

  await register(page, customerEmail)

  await page.getByRole('button', { name: 'Set up your setter' }).click()
  await page.waitForURL(/checkout\.stripe\.com/)

  await page.getByLabel('Email').fill(customerEmail)
  await page.getByPlaceholder('1234 1234 1234 1234').fill('4242424242424242')
  await page.getByPlaceholder('MM / YY').fill('12/34')
  await page.getByPlaceholder('CVC').fill('123')
  await page.getByLabel('Cardholder name').fill('E2E Test')
  await page.getByRole('button', { name: /Pay|Subscribe|Start trial/ }).click()

  await page.waitForURL(/\/checkout\/result\?status=success/)
  await expect(page.getByText('Payment received')).toBeVisible()

  await page.goto('/my-requests')
  await expect(page.getByText('paid')).toBeVisible({ timeout: 30_000 })

  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/en')
  await adminPage.getByRole('button', { name: 'Sign in / Register' }).click()
  const adminDialog = adminPage.locator('.modal-content')
  await adminDialog.getByLabel('Email').fill(ADMIN_EMAIL!)
  await adminDialog.getByLabel('Password').fill(ADMIN_PASSWORD!)
  await adminDialog.getByRole('button', { name: 'Sign in', exact: true }).click()

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
