/**
 * README SCREENSHOTS: drives the live site in a headless browser and saves images
 * to docs/images. Uses the Microsoft Edge already installed on the machine.
 * Run with:  npm run screenshots            (live site)
 *            npm run screenshots -- <url>   (any other address, e.g. a preview version)
 *
 * The agent and customer-note shots replay saved AI runs, so re-running costs nothing.
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
const page = await browser.newPage({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 1.5 })
const tab = (name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
const top = () => page.evaluate(() => window.scrollTo(0, 0))
const scrollTo = (selector: string) =>
  page.locator(selector).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16))

// 1. Overview
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: /SKUs short/ }).waitFor()
await page.screenshot({ path: out('overview.png') })

// 2. Agent: tequila under Acme's rules (replays the saved live run)
await tab('Agent')
await page.locator('main select').selectOption('AGS-750')
await page.getByRole('button', { name: /Run the agent/ }).click()
await page.locator('.briefing').waitFor({ timeout: 90_000 })
await top()
await page.screenshot({ path: out('agent-trace.png') })
const items = page.locator('.queue-item')
for (let i = 0; i < 3; i++) await items.nth(i).getByRole('button', { name: i === 1 ? 'Reject' : 'Approve' }).click()
await scrollTo('.briefing')
await page.screenshot({ path: out('agent-queue.png') })

// 3. Allocation, with one row's reasoning open
await tab('Allocation')
await page.locator('main select').first().selectOption('AGS-750')
await top()
await page.screenshot({ path: out('allocation.png') })
await page.locator('tr.row', { hasText: 'Summit Crest Distributing' }).filter({ hasText: 'FL' }).first().click()
await page.locator('tr.detail').waitFor()
await scrollTo('tr.row.open')
await page.screenshot({ path: out('reasoning.png') })

// 4. Customer note, opened from that row
await page.getByRole('button', { name: /Draft customer note/ }).click()
await page.getByRole('button', { name: /Draft with AI/ }).click()
await page.locator('.email-body').waitFor({ timeout: 60_000 })
await top()
await page.screenshot({ path: out('customer-note.png') })

// 5. Same shortage, two customers
await tab('Compare customers')
await page.locator('main select').selectOption('AGS-750')
await top()
await page.screenshot({ path: out('compare.png') })

// 6. Eval scorecard
await tab('Evals')
await page.locator('tr.row', { hasText: 'Two priority accounts' }).click()
await top()
await page.screenshot({ path: out('evals.png') })

await browser.close()
console.log(`Saved 8 screenshots to ${outDir}`)
