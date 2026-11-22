# semantic_wordcloud — Plan (draft, 2026-11-22)

Word cloud of IEEE VIS 2026 + SC26 text. Each term is weighted with BM25, phrases (n-grams) count as terms, and terms with
related meanings are placed near each other by a force-directed layout. The interface is a WebUVisBox scenario.

## 1. What the sources actually expose (surveyed 2026-11-22)

| Source tag | VIS 2026 | SC26 |
|---|---|---|
| `accepted_entries` | One static page `ieeevis.org/year/2026/program/content/` with 602 `program-card`s. Each card's `data-*` attributes hold the abstract, type, keywords, session and event. Counts: full 145, short 67, tvcg 59, poster 60 (may be incomplete), workshop 100, challenge 30, visap 15, cg&a 11. | Linklings program at `sc26.conference-program.com`, with one ICS export per presentation (`get_cal/?id=sess--pap`) holding the full abstract and authors. Counts: 149 papers, 172 posters, 79 BoFs, 31 tutorials, 20 panels, 43 exhibitor forums. Workshop papers are reachable only through session pages (a few hundred, unverified). |
| `fulltext` | Only author-supplied preprints (arXiv/OSF). A sample of 8 papers suggests roughly 25% have one. TVCG on Xplore is paywalled. The "Paper PDF" link is a signed Supabase URL for registered attendees: **off-limits**. | IEEE CSDL is a JS app and its open-access status is unclear (the site says "OpenTOC in Jan 2027"). There are no arXiv links in the program, so we would match titles against the arXiv / Semantic Scholar APIs. |
| `keynote` | Markdown files in GitHub repo `ieee-vgtc/ieeevis.org`, branch `vis2026`: keynote (Arcand), capstone (Gehlenborg), VISions (Chen, Crisan), plus workshop invited speakers. | Keynote, 12 invited talks, plenary. Abstracts are on Linklings pages and bios are on the `sc26.supercomputing.org/program/*` pages. |
| `website` | Markdown/Astro sources on the `vis2026` branch, pulled through the GitHub API (no crawling). | WordPress REST `/wp-json/wp/v2/{pages,posts}`: 84 pages and 51 posts, stored as heavy page-builder HTML. |

Politeness rules: VIS `robots.txt` sets Crawl-delay 10, which the listing page and GitHub sources let us avoid.
SC is fetched at 1 request/s. Every raw response is cached on disk, so we fetch each URL once.

## 2. Architecture

```
semantic_wordcloud/
├── pipeline/                      Python (uv), offline, produces static artifacts
│   ├── pyproject.toml
│   └── semantic_wordcloud/
│       ├── sources/               one module per site (fetch + parse): vis2026.py, sc26.py; arxiv.py in Phase 4
│       ├── cached_http.py         permanent on-disk HTTP cache + per-host rate limit (the fetch/parse stage boundary)
│       ├── terms/                 tokenize, lemmatize, phrase extraction
│       ├── weighting/             BM25
│       ├── semantics/             term–term similarity (co-occurrence, embedding)
│       └── export/                web artifacts
├── data/                          gitignored: raw/ (HTTP cache), interim/ (jsonl per stage)
└── web/                           Vite host app
    ├── vendor/webuvisbox/         git submodule
    ├── public/data/               exported artifacts
    └── src/Scenarios/SemanticWordCloud/
```

**Key decision: precompute offline, run filters client-side, no server.** Filter changes need no network round trip,
and the site can be deployed to any static host. The pipeline is a chain of stages. Each stage writes a file, so a stage
can be re-run alone, inspected, and diffed.

### 2.1 Document model
`{id, conference: vis|sc, source: accepted_entries|fulltext|keynote|website, track (full/short/tvcg/poster/workshop/BoF/tutorial/panel/…), title, url, authors, text}`.
Scope selector: `VIS | SC | combined`. Within a scope, the filters are `source × track`.
`accepted_entries` = every accepted publication form (papers, posters, workshop papers, BoFs, tutorials, panels, …), stored as abstracts/descriptions.
Pitfall: a paper's full text contains its abstract, so selecting both double-counts it. I propose storing `fulltext`
as the body with the abstract stripped.

### 2.2 Terms
- spaCy (`en_core_web_sm`): tokenize, lemmatize, drop stopwords, plus a domain stoplist ("paper", "propose", "et al",
  "figure", and the like).
- Phrases: noun-chunk candidates of 2–3 tokens, kept only if their NPMI (normalized pointwise mutual information) is
  above a threshold and they appear in at least `min_df` documents. NPMI measures how much more often words occur together than chance would predict.
  This keeps "volume rendering" and drops "proposed method".
- Subsumption: when "uncertainty visualization" is a term, its occurrences are subtracted from "uncertainty" and
  "visualization". Without this, a strong phrase inflates its own parts.

### 2.3 BM25 weighted against common English (decided 2026-11-22)
Goal: emphasize technical terms and terms specific to VIS/SC, not words that are frequent in any English text.
`w(t,d) = idf_bg(t) · tf(t,d)·(k1+1) / (tf(t,d) + k1·(1 − b + b·|d|/avgdl))`, with k1=1.2 and b=0.75.
`idf_bg(t) = ln((N_bg − df_bg(t) + 0.5)/(df_bg(t) + 0.5) + 1)`, taken from a **background corpus of general English**
rather than from our own documents. A term's score is then `score(t,S) = Σ_{d∈S} w(t,d)`.
- Because IDF is fixed, scores stay stable when the selection changes.
- Background: the **Brown Corpus**, 500 samples of 1961 American English across 15 genres, from NLTK. Wikipedia was
  rejected as too technical.
  - With `N_bg = 500`, IDF behaves almost like a gate. Common words get ≈0. Any term in at most 1 sample gets
    5.8–6.9, so among non-common terms the ranking is driven by our own tf.
  - Risk: modern everyday words ("online", "website", "email", "smartphone") are absent from 1961 text and would score
    as if they were technical. Phase 2 checks the top max-IDF terms. If this shows up, we add a modern general corpus
    (OANC/MASC) to the background.
- Content focus (decided): the cloud shows what people talk about. That means:
  - No author or affiliation fields in the text.
  - Keynote abstracts only, no bios.
  - A spaCy NER pass drops PERSON and GPE entities. ORG and PRODUCT stay, because systems and companies like
    "Frontier" and "NVIDIA" are content at SC.
  - An event-vocabulary stoplist ("session", "attendee", "tutorial", "workshop", "registration"). Brown would rate
    these as rare, so the background IDF won't suppress them.
- Terms absent from the background (new acronyms, "exascale") get the maximum IDF. To keep PDF junk and typos from
  dominating, a term must have `min_df` documents in our own corpus.
- The background is processed with the same tokenizer and lemmatizer, matched only against our candidate vocabulary,
  and needs no parser.

We export only each document's top ~200 `w(t,d)`, stored sparse. Roughly 2–3k docs × 200 entries is about 5 MB (binary,
less gzipped), and the client sums that per filter instantly.

### 2.4 Semantics (term similarity)
We compute both measures offline over the top ~5k terms and export each term's 50 nearest neighbors:
- **Co-occurrence PPMI**: positive pointwise mutual information, computed over sentence windows. It is
  corpus-specific and transparent ("these terms appear together here").
- **Embedding cosine**: a small sentence-transformer, e.g. `all-MiniLM-L6-v2` or a science-tuned model. It catches
  synonymy ("UQ" ~ "uncertainty quantification") that co-occurrence misses.

The UI blends the two with a weight `α`. This is cheap to offer and is itself an interesting knob to compare.
Optional: Louvain community detection on the similarity graph gives each semantic region its own color.

### 2.5 Layout
For the visible top-N terms (N≈150–300), edges are each term's top-k (k≈5) neighbors among the visible terms, weighted by
similarity. The layout runs `d3-force` (d3 is already a webuvisbox dependency) with four forces:
1. A link force whose strength follows similarity.
2. Many-body repulsion.
3. A weak centering force.
4. A **rectangle collision force** built from text bounding boxes. d3's built-in collision handles circles only, so
   this one is custom, about 60 lines.

A final overlap-removal pass (PRISM-style, Gansner & Hu 2010) runs after the forces.
- The layout runs in a Web Worker so the UI never blocks.
- On a filter change, it starts from the previous positions. This preserves the mental map, so terms don't scatter on
  every click.
- Prior art worth knowing, to place this work and borrow from:
  - Barth, Kobourov & Pupyrev, "Experimental comparison of semantic word clouds" (2014)
  - Cui et al., context-preserving dynamic word cloud (2010)
  - EdWordle (Wang et al., TVCG 2018), which uses rigid-body neighborhood preservation
  - `d3-cloud` (spiral placement, no semantics): not a fit

### 2.6 Graph rendering in WebUVisBox (long-term)
| Option | Fit | Notes |
|---|---|---|
| **d3-force + own SVG renderer** (recommended now) | Text-as-node, full control | No new deps, fine up to ~1k nodes; we write rectangle collision ourselves |
| graphology + sigma.js | WebGL, 10k+ nodes, FA2/noverlap/Louvain built in | MIT, active. Labels are an overlay, so word-sized text nodes need custom node programs |
| WebCola | Native rectangular non-overlap constraints | MIT, but little maintenance in recent years |
| Cytoscape.js | Mature, many layouts | Heavy, its own rendering world, awkward next to MUI/R3F |

Plan: build `Graph/` inside the scenario folder with no scenario imports. Its parts are a graph type, a layout worker, and
an SVG renderer. Once it holds up, promote it to `webuvisbox/src/Renderers/Graph/`. That is "extract after use":
the API is designed against a real consumer, not guessed. A second consumer is the moment to generalize. graphology
is the upgrade path if we ever need large graphs.

### 2.7 Interface (WebUVisBox scenario, `tool_placement: docked`)
- **Stage (content):** the cloud.
  - Font size encodes √score, so glyph area tracks the score.
  - Color encodes the semantic community.
  - Hovering a term shows faint edges to its neighbors.
  - Clicking a term selects it.
- **Inspector (tools):**
  - *Filters:* conference, source, and track checkboxes, with live document counts.
  - *Terms:* N, n-grams on/off, min df, stoplist toggle.
  - *Semantics/Layout:* α (co-occurrence ↔ embedding), k, link strength, a re-layout button.
  - *Term detail:* the score broken down by conference and source, the term's neighbors, and the documents that
    contain it (title, link out). It shows no full-text snippets (see Q2).
- **Phase-2 idea:** a *VIS vs SC compare* mode with a diverging color for which conference over-represents a term.
  The natural measure there is log-odds with an informative Dirichlet prior (Monroe et al. 2008), not BM25.
- **Perception caveat:** font size is a biased encoding. Long words and tall glyphs read as more important (Alexander
  et al. 2018), so a length-corrected size is worth considering.

## 2.8 Phase 1 as built (2026-11-22)
- SC abstracts come from the ICS export, not the presentation page: the page takes about 3.7 s to render, the ICS
  about 0.2 s.
- SC tracks come from presentation ID prefixes, mapped in `config/sc26_presentation_types.tsv`.
- Website pages are curated in `config/{vis2026,sc26}_website_pages.tsv`: `content` and `community` are included;
  logistics, governance, bios, profiles and similar categories are excluded.
- Entries with fewer than 15 words beyond the title are dropped.
- Within a conference, the same long title is kept once (the longest text). This catches works accepted as both a
  poster and a workshop paper.

## 2.9 Phase 3 as built (2026-11-22)
- Embedding similarity is **contextual**, not the bare term text (decided 2026-11-22). A term is the mean of the
  mean-centered MiniLM embeddings of the sentences it occurs in. Bare-term embeddings mostly measured spelling
  (LLM ~ LLVM).
- Co-occurrence is NPMI over sentences. A pair needs at least 3 sentences in at least 3 different documents.
- Sentences repeated verbatim across documents (457 boilerplate sentences) count once, for BM25 too.
- The layout has two phases: an untangling graph layout (links and repulsion, no collision), then packing
  (collision and an ellipse boundary). Linked pairs end at 0.36–0.55× the distance of random pairs, down from
  0.5–0.7× with one phase. A warm start (after a filter change) skips untangling; "Re-layout from scratch" redoes
  it.
- The layout runs in a Web Worker; text is measured on the main thread.
- Venue color: a diverging scale VIS blue ← text ink → SC red on the SC share, with poles validated per display
  mode. In single-venue scopes words use the plain text color; community colors are Phase 5.

## 3. Phases
1. Repo scaffold, VIS+SC fetch/parse for `abstract`, `keynote`, `website`, and `documents.jsonl` with stats
   (checkpoint: you review the corpus)
2. Terms + BM25 + export; a minimal scenario with a filters panel and a plain (non-semantic) cloud
3. Semantics + force layout in a worker + term-detail panel
4. Full text: arXiv/OSF preprints for VIS, arXiv title-matching for SC
5. Compare mode and communities; promote `Graph/` into webuvisbox

## 4. Open questions
Decided 2026-11-22:
- BM25 IDF comes from general English (2.3).
- Scopes are VIS, SC, and combined.
- Full text is limited to open-access preprints. Only derived statistics are shipped, never text snippets.
- `accepted_entries` covers every accepted publication form.
- snake_case in Python; webuvisbox conventions in TS.
- `git init` here, with webuvisbox as a submodule at `web/vendor/webuvisbox`.

- Background corpus: Brown (2.3).
- Combined scope has a **"Balance venues" toggle**:
  - Off: `Σ_v score_v(t)`, a raw sum.
  - On: `Σ_v score_v(t) · T̄ / T_v`, where `T_v` is the total term count of venue v's *currently selected* documents and
    `T̄` is their mean. Each venue then contributes equal total mass.
  - The toggle carries a one-line caption that explains the difference to the audience.
- Keynotes: abstracts only.

Open:
- Q9 Website source: most of the pages are logistics (hotel, registration, code of conduct). Should we keep only
  content pages (calls, track and program descriptions), or keep everything but leave it off by default?
- Q10 Color in combined scope: VIS-specific / SC-specific / shared (diverging), moved from Phase 5 to Phase 3?
