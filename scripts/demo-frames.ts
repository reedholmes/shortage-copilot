/**
 * README DEMO GIF, step 1 of 2: drives the site in a headless browser and saves one
 * snapshot per step of the tour, plus a captions file.
 * Step 2 (scripts/make_gif.py) stitches the snapshots into docs/images/demo.gif.
 * Run both with:  npm run gif            (or pass a URL to tsx scripts/demo-frames.ts)
 *
 * The agent and note steps replay saved AI runs, so it costs nothing to re-run.
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
  await page.waitForTimeout(300) // let the UI settle
  const file = `frame-${String(frames.length + 1).padStart(2, '0')}.png`
  await page.screenshot({ path: resolve(outDir, file) })
  frames.push({ file, caption, ms })
}
const tab = (name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
const top = (p: Page) => p.evaluate(() => window.scrollTo(0, 0))
const scrollTo = (selector: string) =>
  page.locator(selector).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16))

// 1. Overview
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: /SKUs short/ }).waitFor()
await snap('Three SKUs are short. On tequila, the plan cuts markets out of stock from 13 to 2.', 3200)

// 2. The agent investigates (tequila, Acme's rules)
await page.locator('.card.short', { hasText: 'Agave Sol' }).getByRole('button', { name: /Run agent/ }).click()
await page.getByRole('button', { name: /Run the agent/ }).click()
await page.locator('.trace-step').nth(3).waitFor()
await snap('The agent investigates: inventory, demand, open orders and days on hand.', 2600)
await page.locator('.briefing').waitFor({ timeout: 90_000 })
await top(page)
await snap('The engine sets every number. Claude explains each step and briefs the planner.', 3400)

// 3. An email it drafted
await page.locator('.trace-row', { hasText: 'draft_customer_note' }).first().click()
await scrollTo('.trace-step:nth-child(5)')
await snap('It drafts customer emails, only for lines that execute on their own.', 3400)
await page.locator('.trace-row', { hasText: 'draft_customer_note' }).first().click()

// 4. Approval queue
const items = page.locator('.queue-item')
for (let i = 0; i < 3; i++) await items.nth(i).getByRole('button', { name: i === 1 ? 'Reject' : 'Approve' }).click()
await scrollTo('.briefing')
await snap('Risky lines wait for a person. Code routes them, not the AI.', 3400)

// 5. Two customers
await tab('Compare customers')
await page.locator('main select').selectOption('AGS-750')
await top(page)
await snap("Same shortage, different customer rules: 2 markets out vs 9. Only a config file changed.", 3800)

// 6. Evals
await tab('Evals')
await top(page)
await snap('15 hand-checked scenarios run on every change. 15 of 15 pass.', 3200)

// 7. Allocation detail
await tab('Allocation')
await page.locator('tr.row', { hasText: 'Summit Crest Distributing' }).filter({ hasText: 'FL' }).first().click()
await scrollTo('tr.row.open')
await snap('Every line shows its reasoning, and the planner can override any quantity.', 3400)

await browser.close()
writeFileSync(resolve(outDir, 'frames.json'), JSON.stringify(frames, null, 2))
console.log(`Saved ${frames.length} frames to ${outDir}`)
