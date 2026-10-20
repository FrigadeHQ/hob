import type { StarterRef } from '../../shared/plugins'

const idea = (title: string, icon: string, prompt = title, file = false): StarterRef => ({ title, prompt, icon, pluginId: '', ...(file ? { file: true } : {}) })

/** things to do with a file: they ask for one, then go */
const FILE_IDEAS: StarterRef[] = [
  idea('Check a document for typos', 'pen-line', 'Check this document for spelling and grammar mistakes. List each one with its fix.', true),
  idea('Summarize a document in 5 points', 'list-checks', 'Summarize this in 5 short bullet points, then tell me anything I need to act on.', true),
  idea('Find the to-dos in my notes', 'list-checks', 'Find every action item in this, with who owns it and any deadline.', true),
  idea('Make my writing sound friendlier', 'message-circle', 'Rewrite this so it sounds warm and friendly, without changing what it says.', true),
  idea('Turn notes into a clean report', 'file-text', 'Turn these notes into a short, well-organized report with headings.', true),
  idea('Spot the big costs in a budget', 'coins', 'Look at this budget or statement and tell me the 5 biggest costs and anything unusual.', true),
  idea('Explain a contract simply', 'briefcase', 'Explain this contract in plain words: what I agree to, what it costs, and anything to watch out for.', true),
  idea('Make a quiz from a document', 'graduation-cap', 'Make a 10-question quiz from this, with the answers at the end.', true),
  idea('Shorten a document by half', 'zap', 'Make this half as long without losing anything important.', true),
  idea('Translate a document', 'languages', 'Translate this into English, keeping the formatting.', true),
  idea('Clean up a messy spreadsheet', 'calculator', 'Clean up this spreadsheet: fix obvious errors, remove duplicates, and save a tidy copy.', true),
  idea('Find trends in a spreadsheet', 'chart-column', 'What are the main trends in this spreadsheet? Show them in a chart.', true),
  idea('Write a reply to this email', 'mail', 'Write a short, polite reply to this email.', true),
  idea('Turn a recipe into a list', 'shopping-cart', 'Turn this recipe into a shopping list grouped by aisle.', true),
]
const EVERYDAY: StarterRef[] = [
  idea('Give me a 20-minute dinner idea', 'chef-hat'),
  idea('How does compound interest work?', 'lightbulb', 'Explain how compound interest works'),
  idea('Chart $100 a month over 20 years', 'chart-column', 'Chart how saving $100 a month grows over 20 years at 5% a year.'),
  idea('Plan a weekend in a city I pick', 'plane', 'Help me plan a relaxed weekend in a city. Ask me which one first.'),
  idea('Write a kind birthday message', 'heart', 'Write a short, warm birthday message for a friend.'),
  idea('Make a 30-minute workout', 'dumbbell', 'Make me a 30-minute workout I can do at home with no equipment.'),
  idea('Help me write a cover letter', 'briefcase', 'Help me write a cover letter. Ask me about the job and my experience first.'),
  idea('Explain something like I\'m 10', 'lightbulb', 'Explain how the internet works like I\'m 10 years old.'),
  idea('Plan meals for the week', 'chef-hat', 'Plan 5 simple, healthy dinners for this week, with one shopping list.'),
  idea('Help me say no politely', 'message-circle', 'Help me write a polite way to say no to an invitation.'),
  idea('Make a packing list for a trip', 'plane', 'Make a packing list for a 4-day trip. Ask me where and when first.'),
  idea('Break a big task into steps', 'list-checks', 'Help me break a big task into small steps. Ask me what it is first.'),
  idea('Practice for a job interview', 'briefcase', 'Ask me common job interview questions one at a time and give feedback on my answers.'),
  idea('Learn a few words in Spanish', 'languages', 'Teach me 10 useful Spanish phrases for travel, with how to say them.'),
  idea('Make a simple monthly budget', 'calculator', 'Help me make a simple monthly budget. Ask me about my income and costs.'),
  idea('Come up with gift ideas', 'star', 'Give me 10 thoughtful gift ideas. Ask me who it\'s for first.'),
  idea('Write a short story with me', 'book-open', 'Let\'s write a short story together. Start with an opening paragraph.'),
  idea('Explain a news topic simply', 'newspaper', 'Pick a topic in the news I ask about and explain it simply, both sides.'),
  idea('Make a study plan for an exam', 'graduation-cap', 'Make me a 2-week study plan for an exam. Ask me the subject first.'),
  idea('Help me write a tricky email', 'mail', 'Help me write a tricky email. Ask me what it\'s about first.'),
  idea('Suggest a new hobby', 'palette', 'Suggest 5 hobbies I could start this month, with how to begin each.'),
  idea('Make a morning routine', 'sun', 'Help me make a calm, realistic morning routine.'),
  idea('Name ideas for a project', 'sparkles', 'Give me 15 name ideas for a project. Ask me what it is first.'),
  idea('Walk me through a math problem', 'calculator', 'Walk me through a math problem step by step. I\'ll share it next.'),
  idea('Plan a kid\'s birthday party', 'star', 'Help me plan a kid\'s birthday party on a small budget.'),
  idea('Make a chore chart for the house', 'list-checks', 'Make a fair weekly chore chart for a household of 4.'),
  idea('Write a thank-you note', 'pen-line', 'Write a short thank-you note for a gift.'),
  idea('Help me decide between options', 'lightbulb', 'Help me decide between a few options. Ask me what they are, then compare them.'),
  idea('Make a reading list', 'book-open', 'Suggest 8 great books to read next. Ask what I enjoyed lately first.'),
  idea('Plan a garden for spring', 'leaf', 'Help me plan a small vegetable garden for spring.'),
  idea('Fix a slow computer', 'wrench', 'Give me a simple checklist to speed up a slow computer.'),
  idea('Turn leftovers into dinner', 'chef-hat', 'I\'ll tell you what\'s in my fridge; suggest a dinner I can make from it.'),
  idea('Write a speech for a toast', 'message-circle', 'Help me write a 1-minute toast. Ask me the occasion first.'),
  idea('Explain how a mortgage works', 'coins'),
  idea('Make a game for a road trip', 'gamepad-2', 'Give me 5 fun games to play on a long car ride.'),
  idea('Make a daily schedule', 'clock', 'Help me plan my day around my top 3 priorities.'),
  idea('Write a song verse', 'music', 'Write a short, catchy song verse about a rainy Sunday.'),
  idea('Practice chatting in French', 'languages', 'Have a simple conversation with me in French and gently fix my mistakes.'),
  idea('Plan how to save for something', 'coins', 'Help me make a plan to save for something. Ask me what and by when.'),
  idea('Summarize a topic in 5 points', 'list-checks', 'Summarize the basics of climate change in 5 clear points.'),
  idea('Write a product description', 'shopping-cart', 'Write a short product description. Ask me what I\'m selling first.'),
  idea('Split a bill with the tip', 'calculator', 'A dinner bill was $186 for 5 people. Work out a 20% tip and what each person pays.'),
  idea('Plan a weekend deep clean', 'sparkles', 'Make a weekend deep-cleaning plan I can finish in 4 hours.'),
  idea('Chart my weekly spending', 'chart-column', 'I\'ll tell you what I spent this week; make a chart of it by category.'),
]
/** a different few each new chat */
const rotate = <T,>(list: T[], seed: number, n: number) => list.map((_, i) => list[(i + seed) % list.length]).slice(0, n)
/** always shown: charts are what people most want to see Hob do with a file */
const CHART_IDEA: StarterRef = { title: 'Turn a spreadsheet into a chart', prompt: 'Make a clear chart from this spreadsheet and tell me the main takeaway.', icon: 'chart-column', pluginId: '', file: true }
/** the chart idea, one more that works on a file, two others (plugins first); the rest rotate each new chat */
export function pickStarters(fromPlugins: StarterRef[], seed: number): StarterRef[] {
  const withFile = [...FILE_IDEAS, ...fromPlugins.filter((s) => s.file)]
  const others = [...fromPlugins.filter((s) => !s.file), ...EVERYDAY]
  return [CHART_IDEA, ...rotate(withFile, seed, 1), ...rotate(others, seed, 2)]
}

/** for tests: every title that can show on the home screen */
export const allStarterTitles = () => [CHART_IDEA, ...FILE_IDEAS, ...EVERYDAY].map((s) => s.title)
