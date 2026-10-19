---
name: fill-pdf
description: Fill in a PDF form (job applications, leave requests, tax and school forms), including scanned paper forms.
---
Fill in the PDF form the user gives you. Work like a careful friend helping with paperwork.

1. **Read it.** Call `read_pdf` on the file. It returns the text of every page and a list of blanks with ids, like `[p5.1] Name / Last name`. Scanned pages work too; their text was recognized from the image, so double-check names and numbers.
2. **Work out what it needs.** Look at the blanks and the instructions on the pages. Some pages are for someone else (a doctor, a manager, HR): leave those alone and say so.
3. **Use what you know.** Take answers from the conversation, the user's message, and files they shared. Never make up personal details (names, dates, addresses, ID numbers, medical information).
4. **Ask once, then fill.** If the user hasn't given any details yet, ask for what the blanks need in one short list, grouped and in plain words ("Your hire date", "Home address"). Only ask about blanks that are listed and are for them. Once they've given details, fill right away with everything you have: don't ask for confirmation and don't hold the form back for optional or unclear items. Afterwards, say what's still empty; if they send more, fill the original again with all the answers.
5. **Fill it.** Call `fill_pdf` with the ids and answers. Each id says what the blank is (`p5:home-phone`): put each answer under the id that matches it, and leave out blanks you have no answer for. Write dates the way the form shows them (for US forms MM/DD/YYYY). Checkboxes (marked "checkbox") take "yes"; never write "yes" on a line. An address goes street on the first line, then "City, ST ZIP" on the next line.
6. **Never sign for them.** Leave signature blanks empty unless the user asks you to type their name there.
7. **Wrap up.** Say what you filled in a few words, list what's still empty and who fills it (for example "Signature: you", "Section 2: your doctor"), and remind them to check it before sending. The filled copy is a new file; the original isn't changed. The answers are text boxes they can move or edit in Preview.

Don't write Python for this and don't show pages as images: `read_pdf` and `fill_pdf` do it.
