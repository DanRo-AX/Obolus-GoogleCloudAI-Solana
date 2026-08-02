// Shelf catalogue — the stacks SHELF-1 searches, scanned one shelf at a time.
// A shelf holds MDs that meet the same conditions; opening one settles over x402.
// Excerpts carry lived detail only (no financial data such as bank or card records is collected).

export type Shelf = {
  id: string
  name: string
  category: string
  /** One line on the kind of MD shelved here. */
  summary: string
  /** How many MDs sit on this shelf. */
  mdCount: number
  /** Average price per question, in KRW. Rendered with a ₩ prefix. */
  avgPrice: number
  /** Share of matched MDs that were actually opened. */
  openRate: string
  /** First-person excerpts lifted straight out of the MDs. */
  excerpts: string[]
  /** Shelf accent colour. Used for --card-accent and the shelf label. */
  accent: string
}

export const CATEGORIES: string[] = [
  'Neighborhood',
  'F&B',
  'Commerce',
  'Hiring & Roles',
  'Travel',
  'Crypto & Investing',
  'Parenting & Education',
  'Health',
  'Hobbies & Content',
  'Work & Tools',
]

export const SHELVES: Shelf[] = [
  {
    id: 'seongsu-living',
    name: 'Living in Seongsu',
    category: 'Neighborhood',
    summary:
      'A shelf of daily routes from people who have lived in Seongsu for two years or more, or who commute in every day.',
    mdCount: 840,
    avgPrice: 10,
    openRate: '62%',
    excerpts: [
      'I eat lunch inside Seongsu almost every day, but once the wait goes past 30 minutes I just grab a convenience store lunchbox.',
      'Yeonmujang-gil is unwalkable after 2pm on a weekend, you just get pushed along. I do the grocery run before 10am on Saturday.',
      'The stairs at Seongsu Station exit 3 are narrow, so at rush hour I walk one stop and board at Kondae-ipgu.',
      'The laundry by my place shuts at 8pm, so all my shirts go in together on Wednesday morning.',
      'Plenty of cafes, nowhere to sit and work for long. I rotate between the two that have outlets.',
      'Rent is ₩950,000 with maintenance included, and in summer the air conditioning adds about ₩120,000 on top.',
    ],
    accent: '#C8552B',
  },
  {
    id: 'pangyo-commute',
    name: 'Pangyo commuters',
    category: 'Neighborhood',
    summary:
      'A shelf of timetables and travel habits from people who commute into Pangyo Techno Valley every day.',
    mdCount: 610,
    avgPrice: 10,
    openRate: '58%',
    excerpts: [
      "Miss the 8:10 on the Shinbundang line and I'm late for the morning meeting, so I leave the house at 6:40.",
      "The company shuttle stops running at 8:05 from Jeongja Station exit 3. Miss it and it's ₩9,000 by taxi.",
      'To eat lunch inside Techno Valley I have to be out by 11:40, otherwise the line is long.',
      'When I work late the express buses have stopped, so after 10pm I take a shared bike to Seohyeon.',
      'I barely leave Pangyo on weekends. Even groceries get done in one trip to the department store basement.',
    ],
    accent: '#2F6F8F',
  },
  {
    id: 'jeju-settlers',
    name: 'Three years on Jeju',
    category: 'Neighborhood',
    summary:
      'A shelf of living costs and friction from people who moved from the capital area to Jeju two to five years ago.',
    mdCount: 210,
    avgPrice: 15,
    openRate: '71%',
    excerpts: [
      "Parcels land two days late. If a shop tacks on the ₩3,000 Jeju surcharge I don't order from them at all.",
      "The winter wind is strong enough that from December through February I can't hang laundry outside.",
      'The big hospital is 40 minutes out in Jeju City, so on appointment days I write off the whole day.',
      'From June through August, when the tourists come, I stay off the restaurants along the coastal road. Locals have their own places.',
      "Life doesn't work here without a car. I bought a used compact for ₩3,800,000 and spend about ₩90,000 a month on fuel.",
    ],
    accent: '#3E7C59',
  },
  {
    id: 'indie-cafe-owner',
    name: 'Running a small cafe',
    category: 'F&B',
    summary:
      'A shelf of costs and floor routines from owners who have run a 15-seat-or-smaller cafe themselves for over a year.',
    mdCount: 180,
    avgPrice: 25,
    openRate: '77%',
    excerpts: [
      "I go through 12kg of beans a month. I've changed suppliers twice, and the one I use now is ₩22,000 per kg.",
      'Opening at 7am brings in about 20 people on their way to work, and nearly all of them buy one ₩3,500 americano.',
      'Delivery app fees are steep, so I only keep iced drinks listed over the summer.',
      'I had one employee for a while, now I run it alone. Going to the bathroom is the hardest part of the day.',
      'On rainy days sales drop to about 60% of normal, so on those mornings I prep less stock.',
    ],
    accent: '#8A5A2B',
  },
  {
    id: 'weekday-lunch',
    name: 'Weekday office lunch',
    category: 'F&B',
    summary:
      'A shelf of price limits and queueing habits from people who buy lunch five days a week in office districts.',
    mdCount: 1120,
    avgPrice: 5,
    openRate: '54%',
    excerpts: [
      "₩10,000 is my line for lunch. If a place goes over it, I'll do a convenience store run once that week.",
      'Leave at 12:00 sharp and everywhere is a 20-minute wait, so our team agreed to head out at 11:50.',
      'When the baekban place in front of the office went from ₩8,000 to ₩9,500, half the team stopped going.',
      'On days I eat alone I go to the gukbap place. I can sit down and be back out in 10 minutes.',
      'Coffee after lunch is non-negotiable, but I switched to a ₩1,500 budget chain two years ago.',
    ],
    accent: '#B4553F',
  },
  {
    id: 'home-drinking',
    name: 'Drinking and eating at home',
    category: 'F&B',
    summary:
      'A shelf of weekly patterns from one- and two-person households that eat and drink at home far more than out.',
    mdCount: 470,
    avgPrice: 6,
    openRate: '49%',
    excerpts: [
      'Twice a week, Thursday and Saturday night, I drink two 500ml cans of beer.',
      "Snacks are frozen mandu or the supermarket chicken skewers. I try not to go over ₩5,000.",
      'On weekends I cook four portions of rice, split them up and freeze them. On weekdays I reheat and boil a soup.',
      'One bottle of whisky lasts me three months. I only buy in the ₩50,000 range or below.',
      'I watch cooking videos all the time and actually make something three or four times a year.',
    ],
    accent: '#7A6A3E',
  },
  {
    id: 'dawn-delivery-cart',
    name: 'Overnight delivery carts',
    category: 'Commerce',
    summary:
      'A shelf of repeat items and order times from households using overnight delivery twice a week or more.',
    mdCount: 930,
    avgPrice: 7,
    openRate: '66%',
    excerpts: [
      'I put the order in around 10:30pm. Past 11 it slips to the next day, so I set an alarm.',
      "There's always 2L of milk, cherry tomatoes and tofu in the cart. Every third week I just reorder the same thing.",
      "I used to pile in things I didn't need to hit the ₩40,000 free-shipping line. Now I fill the gap with frozen food.",
      "So many boxes come out of it that recycling day is a chore. If there's a paper packaging option I take it.",
      "I know it's about 15% more than the supermarket, but I have no time to shop after work, so I keep using it.",
    ],
    accent: '#4A6FB0',
  },
  {
    id: 'secondhand-local',
    name: 'Local secondhand trading',
    category: 'Commerce',
    summary:
      'A shelf of haggling limits and meetup habits from people who have traded secondhand in person for three years or more.',
    mdCount: 720,
    avgPrice: 6,
    openRate: '59%',
    excerpts: [
      "I've sold about 140 items in three years. Most are under ₩10,000, so meeting in person beats shipping.",
      'I always set the meetup at the convenience store outside exit 3 of the subway station. I never give out anywhere near my place.',
      'I have a rule for haggling. Up to ₩2,000 I knock it off without arguing; past that I say no.',
      "Kids' clothes I buy, use, and resell on a loop. Each piece moves at around ₩5,000.",
      "I've been no-showed six times. Since then I send one more confirmation message 30 minutes before.",
    ],
    accent: '#6D5AA8',
  },
  {
    id: 'backend-dev-3y',
    name: 'Backend devs, year three',
    category: 'Hiring & Roles',
    summary:
      'A shelf of real stacks, job-hunting hours, and negotiation lines from server developers with two to four years in.',
    mdCount: 540,
    avgPrice: 18,
    openRate: '73%',
    excerpts: [
      "At work it's Java 17 on Spring Boot, but every side project I do is Python.",
      'I job-hunt from 9 to 11 after work. On a weeknight two coding-test problems is my limit.',
      'Nine companies in six months, and I got cut in the final round twice. Both times it was at the salary stage.',
      "If the two remote days a week go away, I'm not moving even for ₩4,000,000 more.",
      "Code review here is a formality and I stopped learning anything from it. That's what actually pushed me to leave.",
    ],
    accent: '#2E7D6B',
  },
  {
    id: 'ward-nurse-shift',
    name: 'Ward nursing on three shifts',
    category: 'Hiring & Roles',
    summary:
      'A shelf of sleep, meal, and spending patterns from ward nurses who have worked rotating three-shift schedules for over a year.',
    mdCount: 300,
    avgPrice: 20,
    openRate: '81%',
    excerpts: [
      'Coming off a night shift at 8am, I pull the blackout curtains and sleep until 3pm.',
      "I get about seven nights a month. If it goes past eight I ask for the next month's roster to be adjusted.",
      'On shift I finish a meal in 12 minutes, which is why I never eat anything with broth.',
      'New shoes every six months. Even a ₩120,000 pair has a collapsed sole by then.',
      "Plans with friends have to be made two months out, because that's when the roster comes.",
    ],
    accent: '#3F7FA6',
  },
  {
    id: 'logistics-field',
    name: 'Warehouse and delivery floor',
    category: 'Hiring & Roles',
    summary:
      'A shelf of volumes and physical wear from people working the floor, from pre-dawn sorting through same-day delivery.',
    mdCount: 260,
    avgPrice: 20,
    openRate: '69%',
    excerpts: [
      'I reach the terminal at 6:30am and start sorting. Everything has to be loaded before 9.',
      'A day runs between 230 and 280 parcels. About ten of the buildings have no elevator.',
      "Lunch is one roll of gimbap in the van. I've sat down to eat twice this month.",
      "In summer I start out with 2L of water and it's gone by 4pm.",
      'My knee puts me in the orthopedic clinic every three months. I never have time for the physio.',
    ],
    accent: '#9A6B2F',
  },
  {
    id: 'paris-resident',
    name: 'Five years in Paris',
    category: 'Travel',
    summary:
      'A shelf of everyday prices and local routes from people who have lived in Paris for three years or more.',
    mdCount: 95,
    avgPrice: 28,
    openRate: '84%',
    excerpts: [
      'I stay out of the tourist quarters entirely on weekends. Groceries are Thursday morning at the neighborhood marche.',
      'I eat out maybe twice a month. The lunch set is €18 and dinner is double that, so dinner happens at home.',
      "The metro strikes often enough that if it's 20 minutes away I'd rather walk.",
      'Korean groceries I buy from a shop over in the 15th. A tub of gochujang runs about €9.',
      'Half the shops on my street close in August. Anyone visiting then, I warn them in advance.',
    ],
    accent: '#8E4C7B',
  },
  {
    id: 'weekend-camping',
    name: 'Weekend car camping',
    category: 'Travel',
    summary:
      'A shelf of booking scrambles and actual spending from people who camp ten or more times a year.',
    mdCount: 380,
    avgPrice: 10,
    openRate: '57%',
    excerpts: [
      'We leave on Friday night. Setting off Saturday morning adds two hours heading toward Gangwon.',
      'About twelve trips a year, and a site runs ₩40,000 to ₩60,000 a night.',
      "Gear-wise I'm still on the same tent, eight years now. The only thing I bought last year was two sleeping bags.",
      'I skip winter camping because the stove is a burden. Instead I go every month right through November.',
      'Bookings open at 10am a month ahead, and the popular sites are gone within 40 seconds.',
    ],
    accent: '#4F7C3A',
  },
  {
    id: 'onchain-wallet',
    name: 'Everyday onchain wallets',
    category: 'Crypto & Investing',
    summary:
      'A shelf of wallet-separation habits and felt fees from people who sign transactions themselves every week.',
    mdCount: 410,
    avgPrice: 20,
    openRate: '78%',
    excerpts: [
      "I split across three wallets. One for spending, one for storage, one for clicking into contracts I've never seen before.",
      "Fees on Solana are cheap, so small payments go through there. About ₩300 a transaction doesn't bother me.",
      "I've made over ten wallets chasing airdrops, and I've actually received one twice.",
      'The seed phrase is written on paper and split between two spots in the house. I never photograph it.',
      "I check the price about six times a day. Three years in and I still can't stop looking the moment I wake up.",
    ],
    accent: '#7B5CD6',
  },
  {
    id: 'monthly-dca',
    name: '₩300,000 a month, on schedule',
    category: 'Crypto & Investing',
    summary:
      'A shelf of rules from small investors who have put the same amount in on the same day for three years or more.',
    mdCount: 660,
    avgPrice: 13,
    openRate: '63%',
    excerpts: [
      '₩300,000 goes in on the 25th of every month. Same day, same amount, three years running.',
      "I keep it under five tickers. Any more and I lose track, and then I start meddling.",
      'I never open the app during market hours. That rule came after two big losses from checking it at work.',
      'Dividends go straight back in. Last year that came to ₩410,000.',
      'Every stock I bought off a video recommendation lost money, so now I stay away from them.',
    ],
    accent: '#1F7A5A',
  },
  {
    id: 'preschool-parenting',
    name: 'First child, ages 5 to 7',
    category: 'Parenting & Education',
    summary:
      'A shelf of timetables and actual spending from parents raising a first child through kindergarten.',
    mdCount: 580,
    avgPrice: 14,
    openRate: '72%',
    excerpts: [
      'The kindergarten bus is at 8:20am. Five minutes late and the whole day slides.',
      "After pickup he has to run around the playground for an hour. Otherwise he's still awake at 10pm.",
      "The kids cafe is about ₩20,000 for two hours, but on a rainy weekend there's never a free spot.",
      'He is a fussy eater, so I rotate the same three banchan. Anything new comes back half-eaten.',
      'Sizes change every six months, so clothes are almost all hand-me-downs or secondhand.',
    ],
    accent: '#D08A2E',
  },
  {
    id: 'middle-school-parent',
    name: 'Paying for middle-school academies',
    category: 'Parenting & Education',
    summary:
      "A shelf of judgement calls from parents who choose and pay for their middle schooler's academies themselves.",
    mdCount: 490,
    avgPrice: 16,
    openRate: '68%',
    excerpts: [
      "The math academy is ₩420,000 a month. With English it comes to ₩780,000, so I moved one of them to online lectures.",
      'The academy shuttle gets in at 10:10pm, and dinner starts from there.',
      "When we switched academies, the thing I weighed most was not grades but whether my kid asks questions.",
      "During exams I send him to the study room for eight hours each weekend day. He can't focus at home.",
      "Half of what goes around the group chat is exaggerated, so in practice I only talk to two parents from his class.",
    ],
    accent: '#B3743F',
  },
  {
    id: 'chronic-medication',
    name: 'Living on daily medication',
    category: 'Health',
    summary:
      'A shelf of dosing habits and hospital routines from people who have taken the same medication every day for three years or more.',
    mdCount: 350,
    avgPrice: 20,
    openRate: '75%',
    excerpts: [
      "Five years of blood pressure pills after breakfast. I keep them next to the toothbrush so I don't forget.",
      'The prescription comes three months at a time. On hospital days I take the morning as half a day off.',
      "I was told to cut salt, so I stopped drinking the broth. Eating out is where that gets hard.",
      'I measure at home twice a week, write the numbers in a notebook, and bring it to the appointment.',
      'The medication is about ₩40,000 for three months. The two-hour wait costs me more than the money does.',
    ],
    accent: '#3A8E86',
  },
  {
    id: 'gym-three-years',
    name: 'Three years in the gym',
    category: 'Health',
    summary:
      'A shelf of routines and spending from people who have lifted three or more times a week for over three years.',
    mdCount: 640,
    avgPrice: 9,
    openRate: '61%',
    excerpts: [
      "Four times a week, 8pm after work. It's the most crowded hour, but it's the only one I have.",
      'I bought two rounds of PT at ₩600,000 for ten sessions. Now I train on my own.',
      'One 2kg tub of protein every two months. Chocolate flavour only.',
      'My knee got worse, so I dropped 20kg off the squat and added reps instead.',
      'In summer I never skip a day, but from December through February it falls to half.',
    ],
    accent: '#5C8C2F',
  },
  {
    id: 'running-routine',
    name: 'Running three times a week',
    category: 'Hobbies & Content',
    summary:
      'A shelf of routes, gear replacement cycles, and times from runners who have kept fixed days for over a year.',
    mdCount: 520,
    avgPrice: 8,
    openRate: '60%',
    excerpts: [
      'Tuesday, Thursday, Sunday at 6am. The default is 8km along the Han toward Jamsu Bridge.',
      "Shoes go at about 600km. That's roughly every seven months, around ₩180,000 a time.",
      'I check the fine dust reading every morning. If it says bad, I swap in 30 minutes indoors.',
      'I enter two races a year. Entry is ₩40,000, and part of why I go is the finisher goods.',
      "My 5km has been stuck in the 26-minute range for a year. I'm still not quitting.",
    ],
    accent: '#D2542F',
  },
  {
    id: 'webtoon-binge',
    name: 'Binge-reading webtoons and web novels',
    category: 'Hobbies & Content',
    summary:
      'A shelf of taste from readers who pay for episodes every day across two or more platforms.',
    mdCount: 870,
    avgPrice: 5,
    openRate: '51%',
    excerpts: [
      'I read through the 40 minutes on the subway each way. Early access runs me about ₩15,000 a month.',
      "Completed series only. I can't stand waiting on an ongoing one, so I hold off until about 100 episodes have piled up.",
      'I read the comments as much as the episode itself. If the comments are dull I drop the series partway.',
      'I read 20 minutes at lunch, but episodes with sound effects get pushed to the evening.',
      'I use three platforms and check every time which one has the same series cheaper.',
    ],
    accent: '#5A63C4',
  },
  {
    id: 'idol-fandom',
    name: 'Idol fandom spending',
    category: 'Hobbies & Content',
    summary:
      'A shelf of buying order and travel habits from fans who spend ₩1,000,000 or more a year on albums, concerts, and merch.',
    mdCount: 430,
    avgPrice: 11,
    openRate: '70%',
    excerpts: [
      'Four copies per album release. I open one and leave three sealed.',
      'Ticketing starts at exactly 8pm, so I switch over to wired internet and wait in the queue.',
      'I spend roughly ₩1,800,000 a year on fandom, and half of that is travel.',
      "I buy merch on the assumption I'll resell it. I've picked up the habit of never opening the packaging.",
      "Birthday cafes I go to on a weekday morning, because on a weekend it's two hours in line.",
    ],
    accent: '#C4508F',
  },
  {
    id: 'small-team-stack',
    name: 'Tool stacks for teams of five or fewer',
    category: 'Work & Tools',
    summary:
      'A shelf of the tools teams of five or fewer are actually paying for, and what they switched away from.',
    mdCount: 240,
    avgPrice: 26,
    openRate: '79%',
    excerpts: [
      'Nine paid subscriptions, ₩410,000 a month. I go through the list once a quarter and cut.',
      "We changed collaboration tools twice. Half the old history vanished each time, so now we stay put.",
      'All meetings are packed into one Tuesday morning slot. Everything else goes through documents.',
      'Customer questions land in one shared inbox. It averages 12 a day, which we can still handle.',
      'You hold out on the free plan, and the moment the team passes four people you end up paying.',
    ],
    accent: '#2D6E9E',
  },
  {
    id: 'smb-office-work',
    name: 'Back-office work at small firms',
    category: 'Work & Tools',
    summary:
      'A shelf of the real tools and bottlenecks of office staff who handle slips, approvals, and reconciliation by hand.',
    mdCount: 780,
    avgPrice: 12,
    openRate: '55%',
    excerpts: [
      'Slips still get sorted in Excel. The file is past 40 sheets and takes 20 seconds to open every time.',
      "Approvals are on paper. If the approver is away from their desk, a day just goes by.",
      "The last three days of the month are guaranteed overtime. I make no evening plans that week.",
      'I proposed bringing in new software twice. Both times it died over not being able to find training time.',
      'I learned the keyboard shortcuts last year, and that alone saves me 30 minutes a day.',
    ],
    accent: '#6B7280',
  },
]
