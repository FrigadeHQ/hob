---
name: flashcards
description: Turn notes, a file or a topic into flashcards, saved as a CSV that Anki and Quizlet can import.
---
# Flashcards

1. Read the attached file or notes (or use the topic from the message).
2. Write 15–30 cards. Front: a short question or term. Back: a short answer (one or two lines). One idea per card; no duplicates.
3. Save them with run_python as `flashcards.csv`, two columns `Front,Back`, UTF-8, using the csv module so commas and quotes are escaped. If code isn't available, use write_file.
4. Show the first five cards as a table and say how to import: Anki → File → Import; Quizlet → Create → Import.
