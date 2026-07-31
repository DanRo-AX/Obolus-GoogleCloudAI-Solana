/**
 * The answer check that stands behind the conduct rules.
 *
 * Onboarding promises a strike for low-effort answers, so something has to
 * actually look at the text. This is the cheap client-side half: it cannot tell
 * whether a story is true, but it can tell when nothing specific was said, and
 * that is what almost every bad answer looks like.
 *
 * It warns rather than blocks. A person who insists their answer is fine can
 * still send it — that is what the dispute is for.
 */

export type Issue = { rule: string; detail: string }

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'been', 'before', 'being',
  'between', 'both', 'could', 'does', 'doing', 'during', 'each', 'from',
  'have', 'having', 'here', 'into', 'just', 'like', 'more', 'most', 'much',
  'only', 'other', 'over', 'same', 'some', 'such', 'than', 'that', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'very', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'your', 'actually', 'really', 'thing', 'things', 'something',
])

const MIN_CHARS = 90
const MIN_WORDS = 14
/** Above this share of the question's own words, it is a restatement. */
const ECHO_MAX = 0.55

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
}

/** A place, a time, a number, a price — the part that cannot be generated. */
function hasSpecifics(text: string): boolean {
  if (/\d/.test(text)) return true
  // A capitalised word that is not just the opening of a sentence.
  return /[^.!?]\s[A-Z][a-z]{2,}/.test(text)
}

export function assess(question: string, answer: string): Issue[] {
  const text = answer.trim()
  const issues: Issue[] = []
  if (!text) return issues

  const words = contentWords(text)
  const unique = new Set(words)

  if (text.length < MIN_CHARS || unique.size < MIN_WORDS) {
    issues.push({
      rule: 'Low-effort answers',
      detail:
        'Too short to be a document. Nobody buys one line, and the buyer who opened this is charged for it either way.',
    })
  }

  if (!hasSpecifics(text)) {
    issues.push({
      rule: 'Low-effort answers',
      detail:
        'No place, time, price, or number anywhere in it. That is exactly the part a general model cannot make up, and the only part worth paying for.',
    })
  }

  const asked = new Set(contentWords(question))
  if (asked.size) {
    const echoed = [...unique].filter((w) => asked.has(w)).length
    if (unique.size && echoed / unique.size > ECHO_MAX) {
      issues.push({
        rule: 'Low-effort answers',
        detail:
          'Mostly the question said back. Answer from what happened to you instead of from the wording of the call.',
      })
    }
  }

  return issues
}
