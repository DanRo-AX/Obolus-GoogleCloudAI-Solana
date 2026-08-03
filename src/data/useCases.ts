// Eight categories for the landing carousel, with three query patterns each.
// tools are the shelves SHELF-1 reaches for first in that category, and
// prompts are questions a client would type into the chat exactly as written.
// label has to match a USE_CASE_THEME key in sources.ts 1:1 for the palette to attach.

/**
 * The shelf mark that sits on a shelf chip. The landing UI draws the chip from
 * the first two characters of the shelf name, so it never reads this value —
 * but if a screen ever hands it to an <img src>, an inline SVG data URI keeps a
 * broken image off the page. No outbound requests.
 */
const SHELF_MARK =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMyIgZmlsbD0iI2UzZThlYSIvPjxyZWN0IHg9IjMuNCIgeT0iMy40IiB3aWR0aD0iOS4yIiBoZWlnaHQ9IjIiIHJ4PSIxIiBmaWxsPSIjNGQ1MzUzIi8+PHJlY3QgeD0iMy40IiB5PSI3IiB3aWR0aD0iOS4yIiBoZWlnaHQ9IjIiIHJ4PSIxIiBmaWxsPSIjNmY3Njc2Ii8+PHJlY3QgeD0iMy40IiB5PSIxMC42IiB3aWR0aD0iOS4yIiBoZWlnaHQ9IjIiIHJ4PSIxIiBmaWxsPSIjOWFhMWExIi8+PC9zdmc+'

export type UseCase = {
  label: string
  tools: { name: string; favicon: string }[]
  prompts: { title: string; prompt: string }[]
}

export const USE_CASES: UseCase[] = [
  {
    label: 'Neighborhood',
    tools: [
      { name: 'Seongsu regulars', favicon: SHELF_MARK },
      { name: '2-hour round trip', favicon: SHELF_MARK },
      { name: 'Moved within a year', favicon: SHELF_MARK },
    ],
    prompts: [
      {
        title: 'Finds the minute a Seongsu lunch line stops being worth it',
        prompt:
          'Ask people who commute into Seongsu every day how many minutes they will stand in a lunch line. I need whether they head out at 12:00 or 12:30, and how many groups ahead of them makes them turn around. Skip district averages. Only collect answers from people who actually eat lunch there.',
      },
      {
        title: 'Works out the break-even for choosing monthly rent over jeonse',
        prompt:
          'Ask people who moved within Seoul in the last year and took monthly rent instead of jeonse for the one reason that settled it, and what their monthly housing cost went from and to. Get one line on whether they still think it was the right call.',
      },
      {
        title: 'Asks what people gave up to cut a 2-hour commute',
        prompt:
          'Ask people who used to travel more than 2 hours round trip and then moved near the office how much more rent they pay each month and what they gave up for it. I also need whether they would make the same call again now that 6 months have passed.',
      },
    ],
  },
  {
    label: 'Food & Drink',
    tools: [
      { name: 'Eats out 3x a week', favicon: SHELF_MARK },
      { name: 'Local regular 6 months+', favicon: SHELF_MARK },
      { name: 'Cut back on delivery', favicon: SHELF_MARK },
    ],
    prompts: [
      {
        title: 'Checks whether a dish in the ₩20,000s earns a second visit',
        prompt:
          'We are putting a pasta dish in the ₩20,000s on the menu. Ask people who ate pasta in Seongsu or Yeonnam in the last month whether they would pay that, and if so whether they would come back a second time. If they would not come back, get the reason in one sentence.',
      },
      {
        title: 'Collects what made people cut delivery orders in half',
        prompt:
          'Ask people who cut their delivery orders to less than half of last year what set it off. I need the delivery fee at which it started to feel like too much, as a number, and where that money goes now. Show each answer the way it was written, not a rolled-up statistic.',
      },
      {
        title: 'Pulls the one real reason a regular became a regular',
        prompt:
          'Ask people who have gone to the same restaurant near home or work at least once a week for more than 6 months to pick one reason they keep going — food, price, distance, or the owner — and write two sentences on why. I need the reason star ratings never show.',
      },
    ],
  },
  {
    label: 'Commerce',
    tools: [
      { name: 'Buys online 5x a month', favicon: SHELF_MARK },
      { name: 'Returned within 6 months', favicon: SHELF_MARK },
      { name: 'Always price-checks', favicon: SHELF_MARK },
    ],
    prompts: [
      {
        title: 'Retraces the moment a full cart stopped short of checkout',
        prompt:
          'Ask people who left something in an online cart in the last month without paying what they put in and which screen they stopped on. Sort the answers by whether it was the shipping fee, the reviews, or just cooling off by the next day.',
      },
      {
        title: 'Checks how a single return ended a brand',
        prompt:
          'Ask people who filed a return with an online store in the last 6 months whether they ever bought from that brand again. If they did not, get one sentence on the exact step where they gave up on it.',
      },
      {
        title: 'Finds where the hand stops between ₩9,900 and ₩12,900',
        prompt:
          'Ask people who buy household basics online at least once a week whether they still buy their usual item when it goes from ₩9,900 to ₩12,900, or start looking elsewhere. If they recently switched away from something for that reason, ask for one example.',
      },
    ],
  },
  {
    label: 'Hiring',
    tools: [
      { name: 'Changed jobs within 3 years', favicon: SHELF_MARK },
      { name: 'Turned down an offer', favicon: SHELF_MARK },
      { name: 'Closed a salary negotiation', favicon: SHELF_MARK },
    ],
    prompts: [
      {
        title: 'Gets the real reason an offer was turned down, first hand',
        prompt:
          'Ask people who received an offer in the last year and turned it down what the one thing was that decided it. I need the pay gap as a percentage, and what the company would have had to add for them to say yes.',
      },
      {
        title: 'Collects what 3-5 year backend engineers are actually paid',
        prompt:
          'Ask backend engineers with 3 to 5 years of experience working in Seoul for their current contracted salary, their most recent raise, and the lowest number they would accept to move. I need what each person is actually paid, not the range printed in job posts.',
      },
      {
        title: 'Lines up the signals seen by people who quit within 6 months',
        prompt:
          'Ask people who quit within 6 months of starting a job which day it first crossed their mind to leave and what set it off. Also get one line on whether there was a signal they could have caught during the interview.',
      },
    ],
  },
  {
    label: 'Travel',
    tools: [
      { name: 'Paris resident 2 years+', favicon: SHELF_MARK },
      { name: 'Abroad 3x a year', favicon: SHELF_MARK },
      { name: 'Travels with kids', favicon: SHELF_MARK },
    ],
    prompts: [
      {
        title: 'Asks where people living in Paris never take a visitor',
        prompt:
          'Ask people who have lived in Paris for 2 years or more to name two places they would never take a visiting friend and two places they take them instead. One sentence of reasoning for each. Leave out anything already sitting at the top of the travel blogs.',
      },
      {
        title: 'Gets receipt-level spend for 4 days in Tokyo',
        prompt:
          'Ask people who took a 4-day, 3-night trip to Tokyo in the last 6 months what they actually spent, split into flights, lodging, food, and transit. I need what each person spent rather than a budget-guide average, plus one line on where they would cut if they went again.',
      },
      {
        title: 'Surfaces the traps only parents who have gone already know',
        prompt:
          'Ask parents who spent 3 or more days in Jeju with a preschool-age child about one plan that did not survive the day and why. I also need what they would drop and what they would add next time.',
      },
    ],
  },
  {
    label: 'Crypto',
    tools: [
      { name: 'On-chain 2 years+', favicon: SHELF_MARK },
      { name: 'Paid in USDC', favicon: SHELF_MARK },
      { name: 'Shipped an x402 integration', favicon: SHELF_MARK },
    ],
    prompts: [
      {
        title: 'Traces the path from USDC to KRW',
        prompt:
          'Ask people who have taken salary or contract pay in USDC what route they used to convert it to KRW and what the fees added up to. I need one line on how they handled it at tax time as well.',
      },
      {
        title: 'Hears the sequence, in order, from people who lost wallet funds',
        prompt:
          'Ask people who lost wallet funds to phishing or a mistake how it happened, how much went, and what they changed afterward. Ask for the sequence in the order it happened, not a list of security rules.',
      },
      {
        title: 'Asks developers who wired up agent payments where they stalled',
        prompt:
          'Ask developers who have shipped agent payments over x402 on Solana how many days it took to get the first payment through and where they were stuck longest. Ask each of them for one thing they had to work out alone because it was not in the docs.',
      },
    ],
  },
  {
    label: 'Parenting',
    tools: [
      { name: 'Raising a child aged 0-3', favicon: SHELF_MARK },
      { name: 'Daycare waitlist', favicon: SHELF_MARK },
      { name: 'Back at work under 1 year', favicon: SHELF_MARK },
    ],
    prompts: [
      {
        title: 'Checks how long a daycare waitlist number takes to move',
        prompt:
          'Ask parents who joined a daycare waitlist in Seoul in the last 2 years what number they started at and how many days it took for a spot to open. I also need what carried them through — grandparents, a sitter, or leave — and what it cost per month.',
      },
      {
        title: 'Hears what broke first in the first month back at work',
        prompt:
          'Ask parents who came back from parental leave less than a year ago what broke first in their first month back. Get the numbers on how much more goes out each month for drop-off, pickup, and sitters.',
      },
      {
        title: 'Counts how fast a ₩100,000 baby item goes unused',
        prompt:
          'Ask parents raising a child aged 3 or under to name one item over ₩100,000 they bought recently and still used after two months, and one they stopped using within a month. I need actual time in use, not review scores.',
      },
    ],
  },
  {
    label: 'Health',
    tools: [
      { name: 'Works out 3x a week', favicon: SHELF_MARK },
      { name: 'Sleep trouble 6 months+', favicon: SHELF_MARK },
      { name: 'Called back for retests', favicon: SHELF_MARK },
    ],
    prompts: [
      {
        title: 'Counts the week a 3-month gym pass actually stops',
        prompt:
          'Ask people who paid for 3 months or more at a gym in the last year how many weeks after paying their last visit was, and what made them stop. For anyone who signed up again, I need what changed that brought them back.',
      },
      {
        title: 'Pulls the one thing that worked for people whose sleep broke',
        prompt:
          'Ask people who have had sleep trouble for 6 months or more to name one thing they tried that worked and one that did nothing at all. Get how many weeks it took before they felt the difference.',
      },
      {
        title: 'Checks what actually changed after a call-back for retests',
        prompt:
          'Ask people who were told to come back for retests or flagged with an abnormal finding at a checkup in the last 2 years for one habit they actually changed and how many months they kept it up. I only need what stuck, not the list of recommendations.',
      },
    ],
  },
]
