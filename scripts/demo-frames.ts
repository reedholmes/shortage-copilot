/**
 * README DEMO GIF, step 1 of 2: drives the live site in a headless browser and saves one
 * snapshot per step of the two-minute tour, plus a captions file.
 * Step 2 (scripts/make_gif.py) stitches the snapshots into docs/images/demo.gif.
 * Run both with:  npm run gif
 *
 * The customer-note step reuses a saved AI draft, so it costs nothing to re-run.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright-core'

const BASE = process.argv[2] ?? 'https://shortage-copilot.reedholmes9.workers.dev'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../docs/.gif-frames')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 })

const frames: { file: string; caption: string; ms: number }[] = []
async function snap(caption: string, ms: number) {
  await page.waitForTimeout(250) // let the UI settle
  const file = `frame-${String(frames.length + 1).padStart(2, '0')}.png`
  await page.screenshot({ path: resolve(outDir, file) })
  frames.push({ file, caption, ms })
}
const toTop = (p: Page) => p.evaluate(() => window.scrollTo(0, 0))
const toTable = (p: Page) => p.locator('.table-head').evaluate((el) => el.scrollIntoView())

// 1. Overview
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: /SKUs are short/ }).waitFor()
await snap('Three of eight SKUs are short. The plan cuts how many markets run out.', 3000)

// 2. Tequila: long in Texas, short in Florida
await page.locator('.card.short', { hasText: 'Agave Sol' }).getByRole('button', { name: /Open allocation/ }).click()
await page.locator('.transfers').waitFor()
await snap('Tequila is long in Texas and nearly out in Florida: move stock within the distributor first.', 3200)

// 3. Reasoning on a row
await page.locator('tr.row', { hasText: 'Gulfline Wine & Spirits' }).filter({ hasText: 'Key distributor' }).first().click()
await page.locator('tr.detail').waitFor()
await toTable(page)
await snap('Every line explains why it ships, waits or gets a partial.', 3600)
await page.locator('tr.row.open').first().click() // close it again

// 4. Override: cut the most at-risk market, then see the cost. Frame shows the tiles and the top rows together.
const tilesInView = (p: Page) => p.locator('.tiles').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16))
await tilesInView(page)
await snap('A planner can override any line. Say we cut the lowest-cover market...', 2600)
const atRisk = page.locator('tr.row', { hasText: 'Magnolia Coast' }).first()
await atRisk.locator('input').fill('100')
await atRisk.locator('input').press('Tab')
await tilesInView(page)
await snap('...the rest re-spreads, and the tiles show the cost in lost sales.', 3600)
await page.getByRole('button', { name: 'Reset all overrides' }).click()

// 5. Forecast blend slider
const slider = page.locator('input[type="range"]')
await slider.fill('0.5')
await toTop(page)
await snap('Trust distributor orders, which some inflate in a shortage...', 2400)
await slider.fill('1')
await snap('...or trust depletions: same supply, fewer markets run out.', 3000)
await slider.fill('0.75')

// 6. Customer note (cached draft, so free)
await page.getByRole('button', { name: '3. Customer note' }).click()
await page.locator('select').nth(1).selectOption('D01-FL')
await page.getByRole('button', { name: /Draft with AI/ }).click()
await page.locator('.email-body').waitFor({ timeout: 60_000 })
await toTop(page)
await snap('Claude drafts the customer email. The engine supplies every number.', 4200)

await browser.close()
writeFileSync(resolve(outDir, 'frames.json'), JSON.stringify(frames, null, 2))
console.log(`Saved ${frames.length} frames to ${outDir}`)
