import type { StarterRef } from '../../shared/plugins'
import { msg, t } from '../../shared/i18n'

const idea = (title: string, icon: string, prompt = title, file = false): StarterRef => ({ title, prompt, icon, pluginId: '', ...(file ? { file: true } : {}) })

/** things to do with a file: they ask for one, then go */
const FILE_IDEAS: StarterRef[] = [
  idea(msg('Check a document for typos'), 'pen-line', msg('Check this document for spelling and grammar mistakes. List each one with its fix.'), true),
  idea(msg('Summarize a document in 5 points'), 'list-checks', msg('Summarize this in 5 short bullet points, then tell me anything I need to act on.'), true),
  idea(msg('Find the to-dos in my notes'), 'list-checks', msg('Find every action item in this, with who owns it and any deadline.'), true),
  idea(msg('Make my writing sound friendlier'), 'message-circle', msg('Rewrite this so it sounds warm and friendly, without changing what it says.'), true),
  idea(msg('Turn my notes into slides'), 'presentation', msg('Turn this into a short PowerPoint deck: a title slide, one slide per main point with a few bullets, and speaker notes.'), true),
  idea(msg('Turn notes into a clean report'), 'file-text', msg('Turn these notes into a short, well-organized report with headings.'), true),
  idea(msg('Spot the big costs in a budget'), 'coins', msg('Look at this budget or statement and tell me the 5 biggest costs and anything unusual.'), true),
  idea(msg('Explain a contract simply'), 'briefcase', msg('Explain this contract in plain words: what I agree to, what it costs, and anything to watch out for.'), true),
  idea(msg('Make a quiz from a document'), 'graduation-cap', msg('Make a 10-question quiz from this, with the answers at the end.'), true),
  idea(msg('Shorten a document by half'), 'zap', msg('Make this half as long without losing anything important.'), true),
  idea(msg('Translate a document'), 'languages', msg('Translate this into English, keeping the formatting.'), true),
  idea(msg('Clean up a messy spreadsheet'), 'calculator', msg('Clean up this spreadsheet: fix obvious errors, remove duplicates, and save a tidy copy.'), true),
  idea(msg('Find trends in a spreadsheet'), 'chart-column', msg('What are the main trends in this spreadsheet? Show them in a chart.'), true),
  idea(msg('Write a reply to this email'), 'mail', msg('Write a short, polite reply to this email.'), true),
  idea(msg('Turn a recipe into a list'), 'shopping-cart', msg('Turn this recipe into a shopping list grouped by aisle.'), true),
]
const EVERYDAY: StarterRef[] = [
  idea(msg('Give me a 20-minute dinner idea'), 'chef-hat'),
  idea(msg('How does compound interest work?'), 'lightbulb', msg('Explain how compound interest works')),
  idea(msg('Chart $100 a month over 20 years'), 'chart-column', msg('Chart how saving $100 a month grows over 20 years at 5% a year.')),
  idea(msg('Plan a weekend in a city I pick'), 'plane', msg('Help me plan a relaxed weekend in a city. Ask me which one first.')),
  idea(msg('Write a kind birthday message'), 'heart', msg('Write a short, warm birthday message for a friend.')),
  idea(msg('Make a 30-minute workout'), 'dumbbell', msg('Make me a 30-minute workout I can do at home with no equipment.')),
  idea(msg('Help me write a cover letter'), 'briefcase', msg('Help me write a cover letter. Ask me about the job and my experience first.')),
  idea(msg('Explain something like I\'m 10'), 'lightbulb', msg('Explain how the internet works like I\'m 10 years old.')),
  idea(msg('Plan meals for the week'), 'chef-hat', msg('Plan 5 simple, healthy dinners for this week, with one shopping list.')),
  idea(msg('Help me say no politely'), 'message-circle', msg('Help me write a polite way to say no to an invitation.')),
  idea(msg('Make a packing list for a trip'), 'plane', msg('Make a packing list for a 4-day trip. Ask me where and when first.')),
  idea(msg('Break a big task into steps'), 'list-checks', msg('Help me break a big task into small steps. Ask me what it is first.')),
  idea(msg('Practice for a job interview'), 'briefcase', msg('Ask me common job interview questions one at a time and give feedback on my answers.')),
  idea(msg('Learn a few words in Spanish'), 'languages', msg('Teach me 10 useful Spanish phrases for travel, with how to say them.')),
  idea(msg('Make a simple monthly budget'), 'calculator', msg('Help me make a simple monthly budget. Ask me about my income and costs.')),
  idea(msg('Come up with gift ideas'), 'star', msg('Give me 10 thoughtful gift ideas. Ask me who it\'s for first.')),
  idea(msg('Write a short story with me'), 'book-open', msg('Let\'s write a short story together. Start with an opening paragraph.')),
  idea(msg('Explain a news topic simply'), 'newspaper', msg('Pick a topic in the news I ask about and explain it simply, both sides.')),
  idea(msg('Make a study plan for an exam'), 'graduation-cap', msg('Make me a 2-week study plan for an exam. Ask me the subject first.')),
  idea(msg('Help me write a tricky email'), 'mail', msg('Help me write a tricky email. Ask me what it\'s about first.')),
  idea(msg('Suggest a new hobby'), 'palette', msg('Suggest 5 hobbies I could start this month, with how to begin each.')),
  idea(msg('Make a morning routine'), 'sun', msg('Help me make a calm, realistic morning routine.')),
  idea(msg('Name ideas for a project'), 'sparkles', msg('Give me 15 name ideas for a project. Ask me what it is first.')),
  idea(msg('Walk me through a math problem'), 'calculator', msg('Walk me through a math problem step by step. I\'ll share it next.')),
  idea(msg('Plan a kid\'s birthday party'), 'star', msg('Help me plan a kid\'s birthday party on a small budget.')),
  idea(msg('Make a chore chart for the house'), 'list-checks', msg('Make a fair weekly chore chart for a household of 4.')),
  idea(msg('Write a thank-you note'), 'pen-line', msg('Write a short thank-you note for a gift.')),
  idea(msg('Help me decide between options'), 'lightbulb', msg('Help me decide between a few options. Ask me what they are, then compare them.')),
  idea(msg('Make a reading list'), 'book-open', msg('Suggest 8 great books to read next. Ask what I enjoyed lately first.')),
  idea(msg('Plan a garden for spring'), 'leaf', msg('Help me plan a small vegetable garden for spring.')),
  idea(msg('Fix a slow computer'), 'wrench', msg('Give me a simple checklist to speed up a slow computer.')),
  idea(msg('Turn leftovers into dinner'), 'chef-hat', msg('I\'ll tell you what\'s in my fridge; suggest a dinner I can make from it.')),
  idea(msg('Write a speech for a toast'), 'message-circle', msg('Help me write a 1-minute toast. Ask me the occasion first.')),
  idea(msg('Explain how a mortgage works'), 'coins'),
  idea(msg('Make a game for a road trip'), 'gamepad-2', msg('Give me 5 fun games to play on a long car ride.')),
  idea(msg('Make a daily schedule'), 'clock', msg('Help me plan my day around my top 3 priorities.')),
  idea(msg('Write a song verse'), 'music', msg('Write a short, catchy song verse about a rainy Sunday.')),
  idea(msg('Practice chatting in French'), 'languages', msg('Have a simple conversation with me in French and gently fix my mistakes.')),
  idea(msg('Plan how to save for something'), 'coins', msg('Help me make a plan to save for something. Ask me what and by when.')),
  idea(msg('Summarize a topic in 5 points'), 'list-checks', msg('Summarize the basics of climate change in 5 clear points.')),
  idea(msg('Write a product description'), 'shopping-cart', msg('Write a short product description. Ask me what I\'m selling first.')),
  idea(msg('Split a bill with the tip'), 'calculator', msg('A dinner bill was $186 for 5 people. Work out a 20% tip and what each person pays.')),
  idea(msg('Plan a weekend deep clean'), 'sparkles', msg('Make a weekend deep-cleaning plan I can finish in 4 hours.')),
  idea(msg('Chart my weekly spending'), 'chart-column', msg('I\'ll tell you what I spent this week; make a chart of it by category.')),
]
/** a different few each new chat */
const rotate = <T,>(list: T[], seed: number, n: number) => list.map((_, i) => list[(i + seed) % list.length]).slice(0, n)
/** always shown: charts are what people most want to see Hob do with a file */
const CHART_IDEA: StarterRef = { title: msg('Turn a spreadsheet into a chart'), prompt: msg('Make a clear chart from this spreadsheet and tell me the main takeaway.'), icon: 'chart-column', pluginId: '', file: true }
/** shown until email and calendar are connected: the thing that makes Hob most useful day to day */
export const CONNECT_IDEA: StarterRef = { title: msg('Connect my email and calendar'), prompt: '', icon: 'calendar', pluginId: '', connect: true }

/** three ideas: the chart, one more that works on a file, one other (plugins first); the rest rotate each new chat.
 * connect: email and calendar aren't connected yet, so that idea takes the file idea's place */
export function pickStarters(fromPlugins: StarterRef[], seed: number, o: { connect?: boolean } = {}): StarterRef[] {
  const withFile = [...FILE_IDEAS, ...fromPlugins.filter((s) => s.file)]
  const others = [...fromPlugins.filter((s) => !s.file), ...EVERYDAY]
  // shown and sent in the interface's language
  return [CHART_IDEA, ...(o.connect ? [CONNECT_IDEA] : rotate(withFile, seed, 1)), ...rotate(others, seed, 1)]
    .map((s) => ({ ...s, title: t(s.title), prompt: s.prompt && t(s.prompt) }))
}

/** for tests: every title that can show on the home screen */
export const allStarterTitles = () => [CHART_IDEA, CONNECT_IDEA, ...FILE_IDEAS, ...EVERYDAY].map((s) => s.title)
