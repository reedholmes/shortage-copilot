/**
 * README SCREENSHOTS: drives the live site in a headless browser and saves images
 * to docs/images. Uses the Microsoft Edge already installed on the machine.
 * Run with:  npm run screenshots            (live site)
 *            npm run screenshots -- <url>   (any other address, e.g. local dev)
 *
 * The customer-note shot reuses a saved AI draft, so it costs nothing to re-run.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'https://shortage-copilot.reedholmes9.workers.dev'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../docs/images')
mkdirSync(outDir, { recursive: true })
const out = (name: string) => resolve(outDir, name)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5 })

// 1. Shortage overview
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: /SKUs are short/ }).waitFor()
await page.screenshot({ path: out('overview.png') })

// 2. Allocation: the long/short tequila scenario, with one row's reasoning open
await page.locator('.card.short', { hasText: 'Agave Sol' }).getByRole('button', { name: /Open allocation/ }).click()
await page.locator('.transfers').waitFor()
await page.screenshot({ path: out('allocation.png') })
// Gulfline FL: a key distributor at stockout risk, served first. It sits near the top of the table.
await page.locator('tr.row', { hasText: 'Gulfline Wine & Spirits' }).filter({ hasText: 'Key distributor' }).first().click()
await page.locator('tr.detail').waitFor()
await page.locator('.table-head').evaluate((el) => el.scrollIntoView())
await page.screenshot({ path: out('reasoning.png') })

// 3. Customer note for the same market
await page.getByRole('button', { name: '3. Customer note' }).click()
await page.locator('select').nth(1).selectOption('D01-FL')
await page.getByRole('button', { name: /Draft with AI/ }).click()
await page.locator('.email-body').waitFor({ timeout: 60_000 })
await page.screenshot({ path: out('customer-note.png') })

await browser.close()
console.log(`Saved 4 screenshots to ${outDir}`)
