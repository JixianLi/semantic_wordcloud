# semantic_wordcloud

A word cloud of IEEE VIS 2026 and SC26: what people talk about across accepted entries, keynote abstracts and
website content. Terms are weighted with BM25 against general English (the Brown Corpus), phrases (n-grams) count as
terms, and the interface is a [WebUVisBox](https://github.com/JixianLi/webuvisbox) scenario. Design and decisions:
[PLAN.md](PLAN.md).

```
pipeline/   Python (uv): fetch the corpus, build terms and weights
web/        Vite app; webuvisbox is a git submodule in web/vendor/webuvisbox
data/       generated, not committed (raw HTTP cache, interim files)
```

## Getting the data

Nothing under `data/` or `web/public/data/` is committed. To rebuild it:

```bash
git clone --recurse-submodules <this repo>   # or: git submodule update --init
cd pipeline
uv sync                     # Python 3.12, spaCy + en_core_web_sm, NLTK
uv run collect-corpus       # 1. fetch and clean the corpus
uv run build-terms          # 2. terms, phrases, BM25 weights, web export
```

1. **`collect-corpus`** fetches the VIS 2026 program listing, the ieeevis.org website repo (GitHub, branch `vis2026`),
   the SC26 program (sessions plus one ICS export per presentation) and the SC26 WordPress API.
   - Writes `data/raw/` (every response, cached permanently), `data/interim/documents.jsonl` and
     `data/interim/corpus_report.md`.
   - The first run makes about 2,000 requests, at one per second per host, and takes roughly 40 minutes. Later runs
     read the cache and take seconds. Delete a file in `data/raw/` to refetch it.
   - Which pages and presentation types count is set in `pipeline/config/*.tsv`.
2. **`build-terms`** tokenizes with spaCy and downloads the Brown Corpus through NLTK into `data/external/` (once).
   - Writes `web/public/data/corpus.json` (about 3 MB, what the app loads), `data/interim/term_tokens.jsonl` and
     `data/interim/terms_report.md` (top terms, entity drops, Brown-unseen terms for review).
   - Takes about a minute. Stoplist and entity allowlist: `pipeline/config/stop_terms.txt`,
     `pipeline/config/entity_allowlist.txt`.

The sources are public pages. Full text is limited to open-access preprints (not yet fetched). The app ships derived
term statistics, titles and links, not abstracts or page text.

## Running the app

```bash
cd web
npm install
npm run dev                 # http://localhost:5173, needs web/public/data/corpus.json
```
