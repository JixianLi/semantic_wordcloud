# semantic_wordcloud

A word cloud of IEEE VIS 2026 and SC26: what people talk about across accepted entries, keynote abstracts and
website content. Terms are weighted with BM25 against general English (the Brown Corpus), phrases (n-grams) count as
terms, and the interface is a [WebUVisBox](https://github.com/JixianLi/webuvisbox) scenario. Design and decisions:
[PLAN.md](PLAN.md).

```
scripts/    Python (uv): fetch the corpus, rate-limited and cached (web pages, preprints)
pipeline/   Python (uv): build terms, weights and term similarity from the fetched corpus
web/        Vite app; webuvisbox is a git submodule in web/vendor/webuvisbox
data/       generated, not committed (raw HTTP cache, interim files)
```

## Getting the data

Nothing under `data/` or `web/public/data/` is committed. To rebuild it:

```bash
git clone --recurse-submodules <this repo>   # or: git submodule update --init
cd scripts
uv run fetch-web            # 1a. conference programs, keynotes, website pages
uv run fetch-papers         # 1b. open-access preprint full text (after fetch-web)
cd ../pipeline
uv run build-terms          # 2. terms, phrases, BM25 weights, web export (Python 3.12, spaCy, NLTK)
uv run build-semantics      # 3. term similarity (co-occurrence, contextual embedding)
```

1. **Fetching** (`scripts/`, light dependencies, no NLP packages). Both commands print the minimum interval per host
   before they start and a per-host count of requests and cache hits at the end. `--seconds-between-requests
   HOST=SECONDS` (repeatable) raises an interval; the defaults follow each site's robots.txt crawl delay and should
   not be lowered. Both share the cache in `data/raw/`.

   **`fetch-web`** fetches the VIS 2026 program listing, the ieeevis.org website repo (GitHub, branch `vis2026`),
   the SC26 program (sessions plus one ICS export per presentation) and the SC26 WordPress API.
   - Writes `data/raw/` (every response, cached permanently), `data/interim/documents.jsonl` and
     `data/interim/corpus_report.md`.
   - The first run makes about 2,000 requests, at one per second per host, and takes roughly 40 minutes. Later runs
     read the cache and take seconds. Delete a file in `data/raw/` to refetch it.
   - Which pages and presentation types count is set in `scripts/config/*.tsv`.
   - Writing `documents.jsonl` drops the full texts, so run `fetch-papers` after it.

   **`fetch-papers`** adds full text. Entry titles are matched against the arXiv API (batches of 10, one query every
   5 s, with backoff when arXiv answers 429). A match needs near-identical titles, publication in 2025 or later, and a
   shared author surname. Every match is listed in `data/interim/fulltext_matches.tsv` for review. Bodies come from
   arXiv's HTML version, or the PDF if there is none, at arxiv.org's 15 s crawl delay. Abstract, references and
   acknowledgments are dropped. With a few hundred matches the first run takes about 1.5 hours.
2. **`build-terms`** tokenizes with spaCy and downloads the Brown Corpus through NLTK into `data/external/` (once).
   - Writes `web/public/data/corpus.json` (about 3 MB, what the app loads), `data/interim/term_tokens.jsonl` and
     `data/interim/terms_report.md` (top terms, entity drops, Brown-unseen terms for review).
   - Takes about a minute. Stoplist and entity allowlist: `pipeline/config/stop_terms.txt`,
     `pipeline/config/entity_allowlist.txt`.
3. **`build-semantics`** writes `web/public/data/neighbors.json` (about 2 MB): each term's nearest terms by
   co-occurrence and by contextual embedding (`all-MiniLM-L6-v2`, downloaded from Hugging Face once, about 90 MB).
   Takes about 10 seconds with an Apple GPU.

The sources are public pages. Full text is limited to open-access arXiv preprints. The app ships derived
term statistics, titles and links, not abstracts or page text.

## Running the app

```bash
cd web
npm install
npm run dev                 # http://localhost:5173, needs web/public/data/corpus.json
```

## Deploying to GitHub Pages

The site is served from the `gh-pages` branch at https://jixianli.github.io/semantic_wordcloud/. The data is built
locally (see above), so deploying is a local step:

```bash
cd web
npm run deploy              # builds, then pushes dist/ (app + data) to the gh-pages branch
```

Only `gh-pages` carries the data files; `main` stays code-only. Each deploy adds about 12 MB to that branch's history.

## License

The code in this repository is MIT licensed; see [LICENSE](LICENSE).

The MIT license covers the code only. Titles, abstracts, page text and preprints from the IEEE VIS and SC
conference websites and programs and from arXiv belong to their authors, owners and publishers. This project claims
no rights to them. The deployed data files (`corpus.json`, `neighbors.json`) contain entry titles and links to the
original pages alongside derived term statistics; the titles remain the property of their owners.
