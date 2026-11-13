/**
 * Drafting the out-of-stock email.
 *  - draftWithClaude: asks Claude for the email as structured JSON (subject, body, summary).
 *  - templateNote: a plain fill-in-the-blanks version used whenever the AI is unavailable
 *    or a limit is hit, so the demo always shows something correct.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { NoteFacts } from '../src/engine/noteFacts'

export const MODEL = 'claude-opus-5-5'

/** The exact JSON shape Claude must return. The API enforces it. */
export const DraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  summary: z.string(),
})
export type Draft = z.infer<typeof DraftSchema>

const SYSTEM_PROMPT = `You write out-of-stock notices from a beverage alcohol supplier's Supply Planning Team to a distributor partner.

Tone: direct and practical, the way an experienced planner writes to a distributor they work with every week. Lead with what is short and the numbers. One brief apology, no groveling. Close with a clear next step.

Rules:
- Use only the facts provided. Do not invent quantities, dates, causes, promotions, or promises.
- All quantities are 9-liter cases. Write them as "cases".
- Cover: what is shipping now, what is backordered, when supply lands, and roughly how long the backordered cases will wait.
- If an incoming intracompany transfer is listed, mention it as a near-term bridge from their other market.
- Body: plain text, under 160 words, greet the distributor's team by company name, sign off as "Supply Planning Team".
- Subject: under 80 characters, include the product and the word backorder.
- Summary: one sentence for the planner's internal log.`

/** Calls Claude. Throws on any failure so the caller can fall back to the template. */
export async function draftWithClaude(facts: NoteFacts, apiKey: string): Promise<Draft> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 })
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Server-side fallback: if the model declines, the API retries on a suitable model in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // Low effort: a short templated email doesn't need deep reasoning, and it keeps cost and wait down.
    output_config: { effort: 'low', format: betaZodOutputFormat(DraftSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Draft the notice from these facts:\n${JSON.stringify(facts, null, 2)}` }],
  })
  if (response.stop_reason === 'refusal') throw new Error('Model declined the request')
  if (!response.parsed_output) throw new Error(`No structured output (stop_reason: ${response.stop_reason})`)
  console.log(
    `draft ok: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens, model ${response.model}`,
  )
  return response.parsed_output
}

/** Fill-in-the-blanks fallback. Always correct, never creative. */
export function templateNote(f: NoteFacts): Draft {
  const transfer = f.incomingTransfer
    ? ` In the meantime, ${f.incomingTransfer.cases} cases are moving from your ${f.incomingTransfer.fromMarket} market and should arrive in about ${f.incomingTransfer.arrivesInDays} days.`
    : ''
  return {
    subject: `${f.sku}: ${f.backorderedCases} cases on backorder until ${f.supplyLandsOn}`,
    body:
      `Hi ${f.distributor} team,\n\n` +
      `We're short on ${f.sku}. Of the ${f.orderedCases} cases you ordered for ${f.market}, ${f.shippingNowCases} ship now and ${f.backorderedCases} are on backorder.` +
      `${transfer}\n\n` +
      `Our next production run lands on ${f.supplyLandsOn}, so the backordered cases will wait about ${f.daysOrdersWillSit} days. We'll ship them as soon as it arrives. Sorry for the disruption.\n\n` +
      `Let us know if you need to reprioritize any of your open orders.\n\n` +
      `Supply Planning Team`,
    summary: `Notified ${f.distributor} (${f.market}) of ${f.backorderedCases} cs backordered on ${f.sku} until ${f.supplyLandsOn}.`,
  }
}
