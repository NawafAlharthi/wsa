# WSA — Word Selector

A static website that replaces the old WSA application + "Output Statistics-Master Sheet" workflow.
Each run selects 100 Arabic words from the 1,000-word database according to the seven Egan
criteria in *Word Selector – Design Criteria – Rev 002*, and computes every statistic the master
sheet produced — no spreadsheet step needed.

## Files

- `index.html` — the website (open via any static server, or just double-click it)
- `app.js` — selection algorithm, statistics, charts, CSV export
- `data.js` — the 1,000-word database (generated from `Input.xlsx`), optimal letter
  percentages (from the master sheet), and the 46 phonetically-similar pairs
- `words.json` — intermediate extraction of `Input.xlsx` (source for `data.js`)
- `artifact.html` — single-file bundle of the above, published to claude.ai as a private artifact

## How selection works

Each list must satisfy, simultaneously:

| Criterion | Distribution |
|---|---|
| Category | 2→5, 2+→14, 3→60, 3+→18, 3++→3 |
| Word type | 1→3, 2→77, 3.1→15, 3.2→3, 3.3→1, 4→1 |
| Commonness | ≤1.5→64, >1.5–2→19, >2–2.5→13, >2.5→4 |
| Difficulty | 1–2→1, >2–3→2, >3–4→8, >4–4.5→13, >4.5→76 |

plus: 100 unique words, no phonetically-similar pair in the same list, and no word repeats
across lists until the full 1,000 words are used (tracked in the browser's localStorage;
"Reset cycle" clears it).

The selector is a randomized hill-climb (cost = total deviation from the four distributions
+ penalty per phonetic conflict, random swap accepted when cost does not increase, with
restarts). Cost 0 = fully compliant list.

**Note:** the database itself does not divide into 10 perfectly compliant lists (e.g. only
6 words of type 3.3 exist but 10 lists would need 10; category 3 has 597 of the 600 needed).
The first ~4 lists are always exact; later lists get as close as the remaining pool allows,
and the compliance panel shows the exact deviation per group.

## Audio

The database references clips named `L01-0001.mp3` etc. Put the MP3 files in an `audio/`
folder next to `index.html` and the ▶ buttons will play them. Without the files a toast
explains where to put them.

## CSV export

The exported CSV matches the layout the master sheet's *Results* tab expected
(No. column + the 24 columns of `Input.xlsx`), UTF-8 with BOM so Excel renders the Arabic.
