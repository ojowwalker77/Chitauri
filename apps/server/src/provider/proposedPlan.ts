/**
 * Shared proposed-plan helpers for provider adapters.
 *
 * Some providers surface a finished plan as tagged markdown inside the final
 * assistant message rather than as a first-class event. The extractor keeps the
 * UI path provider-agnostic by converting that markdown into a canonical
 * `turn.proposed.completed` runtime event.
 */

const PROPOSED_PLAN_BLOCK_REGEX = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i;

export function extractProposedPlanMarkdown(text: string | undefined): string | undefined {
  const match = text ? PROPOSED_PLAN_BLOCK_REGEX.exec(text) : null;
  const planMarkdown = match?.[1]?.trim();
  return planMarkdown && planMarkdown.length > 0 ? planMarkdown : undefined;
}
