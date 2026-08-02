import { test, expect, type Page } from '@playwright/test'

// The signed-in surfaces have no other automated coverage, and they were moved
// onto "Der Rundgang" without anyone being able to look at them — reaching them
// needs an account. This registers one and asserts the things that would show a
// half-migrated screen: a retired face still loading, a rounded or blurred
// element, a sideways scroll, a console error.
async function register(page: Page, email: string) {
  await page.getByRole('button', { name: 'Sign in / Register' }).click()
  const dialog = page.locator('.modal-content')
  await dialog.getByText('No account yet? Register').click()
  await dialog.getByLabel('Company name').fill('Smoke Test Co')
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Password').fill('smoke-test-password-123')
  await dialog.getByRole('button', { name: 'Register', exact: true }).click()
}

test('the signed-in surfaces render in the migrated world', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/en')
  await register(page, `smoke-${Date.now()}@example.com`)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 15_000 })

  for (const route of ['/my-requests', '/app/chats']) {
    await page.goto(route)
    // Something actually rendered, rather than a blank shell.
    await expect(page.locator('main')).not.toBeEmpty()

    const report = await page.evaluate(() => {
      const fonts = new Set<string>()
      const offenders: string[] = []
      document.querySelectorAll('main *, nav *, footer *').forEach((el) => {
        const c = getComputedStyle(el)
        fonts.add(c.fontFamily.split(',')[0]!.replace(/"/g, ''))
        const r = c.borderRadius
        if ((r && r !== '0px' && r !== '') || c.backdropFilter !== 'none') {
          offenders.push(`${el.tagName}.${el.className} r=${r} bf=${c.backdropFilter}`)
        }
      })
      return {
        fonts: [...fonts],
        offenders: offenders.slice(0, 5),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })

    expect(report.fonts.sort(), `${route} runs only the two faces`).toEqual(
      expect.arrayContaining(['Archivo']),
    )
    expect(report.fonts, `${route} has no legacy faces`).not.toContain('DM Sans')
    expect(report.fonts, `${route} has no legacy faces`).not.toContain('Space Grotesk')
    expect(report.offenders, `${route} is square and unblurred`).toEqual([])
    expect(report.overflow, `${route} does not scroll sideways`).toBe(0)
  }

  expect(errors, 'no console errors on the signed-in surfaces').toEqual([])
})
