# Import and export

## Import from Anki

Run **Import Anki deck**. Choose an `.apkg`, `.colpkg`, `.txt`, `.csv`, or `.tsv` file from your vault, a target folder (default `Flashcards/Imported`), and import options. Packages can include media and nested decks. Existing Anki notes are recognised on later imports and are not duplicated.

Card text, decks, and compatible media are converted to Markdown. Review schedules are not imported. If an Anki cloze requires it, Flashcard Studio adds a compatible cloze pattern.

## Export to Anki

Run **Export cards to Anki**. Select decks and choose an Anki package (`.apkg`) or text file. Exports go to `Flashcards/Exports` by default. Review schedules are not exported. The dialog reports cards it skips because Anki cannot represent them.

Image-occlusion masks export as basic cards with the question and image on the front and the mask answer on the back.
