import type { Resolution } from '@/lib/api'

export type ResearchBranch = {
  phase: 'confirm' | 'baseline' | 'ask-order' | 'declined'
  generateBaseline: boolean
}

type AgentNextAction = NonNullable<Resolution['agentRun']>['nextAction']

/**
 * Turn the server-validated agent proposal into a product branch.
 *
 * The model never receives spending authority: this function can only expose
 * an approval screen, request a free baseline, offer an Open Call, or stop.
 * Older API responses without an agent trace preserve the previous behavior.
 */
export function branchForAgentAction(
  decision: Resolution['decision'],
  aiBaselineEligible: boolean,
  nextAction?: AgentNextAction,
): ResearchBranch {
  if (decision === 'hit') {
    return nextAction === 'finish_without_purchase'
      ? { phase: 'declined', generateBaseline: false }
      : { phase: 'confirm', generateBaseline: false }
  }

  if (nextAction === 'finish_without_purchase') {
    return { phase: 'declined', generateBaseline: false }
  }

  if (nextAction === 'generate_general_baseline') {
    return { phase: 'baseline', generateBaseline: aiBaselineEligible }
  }

  if (!nextAction && aiBaselineEligible) {
    return { phase: 'baseline', generateBaseline: true }
  }

  return {
    phase: 'ask-order',
    // An Open Call is shown here only when the validated agent explicitly
    // proposes one. A plain retrieval miss must not silently become paid human
    // research; that path is handled by the baseline branch above.
    generateBaseline: aiBaselineEligible,
  }
}
