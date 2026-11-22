"""Stage 1: fetch every source (cached) and write data/interim/documents.jsonl plus a corpus report.

Run: uv run collect-corpus
"""

import re
from collections import Counter, defaultdict
from pathlib import Path

from .cached_http import CachedHttpClient
from .documents import Document, write_documents
from .sources import sc26, vis2026

PIPELINE_DIR = Path(__file__).resolve().parents[2]
CONFIG_DIR = PIPELINE_DIR / "config"
DATA_DIR = PIPELINE_DIR.parent / "data"
DOCUMENTS_PATH = DATA_DIR / "interim" / "documents.jsonl"
REPORT_PATH = DATA_DIR / "interim" / "corpus_report.md"
# ieeevis.org's robots.txt asks for a 10 s crawl delay; everything else gets 1 s.
SECONDS_BETWEEN_REQUESTS_BY_HOST = {"ieeevis.org": 10.0}
WORD = re.compile(r"\w+")
# An entry whose text beyond its title is shorter than this has no abstract to speak of (e.g. a workshop talk listed
# with speakers only).
MIN_CONTENT_WORDS = 15
# Titles this short ("Community", "Papers in Conversation") name a page or session kind, not a work.
MIN_WORDS_FOR_TITLE_IDENTITY = 5


def main() -> None:
    client = CachedHttpClient(DATA_DIR / "raw", SECONDS_BETWEEN_REQUESTS_BY_HOST)
    documents = vis2026.collect_documents(client, CONFIG_DIR) + sc26.collect_documents(client, CONFIG_DIR)
    documents = [document for document in documents if content_word_count(document) >= MIN_CONTENT_WORDS]
    documents = drop_duplicate_works(documents)
    write_documents(documents, DOCUMENTS_PATH)
    REPORT_PATH.write_text(corpus_report(documents))
    print(f"{len(documents)} documents -> {DOCUMENTS_PATH}\nreport -> {REPORT_PATH}")


def content_word_count(document: Document) -> int:
    body = document.text.split("\n\n", 1)[1] if document.text.startswith(document.title + ".") else document.text
    return len(WORD.findall(body))


def drop_duplicate_works(documents: list[Document]) -> list[Document]:
    """One document per work within a conference. The same work can be accepted in two forms (a poster and a workshop
    paper) with near-identical abstracts; counting both would double its terms. Keeps the longest text and records
    the other ids in extra["duplicate_ids"]."""
    kept_by_key: dict[tuple, Document] = {}
    unkeyed = []
    for document in documents:
        if document.source != "accepted_entries" or len(WORD.findall(document.title)) < MIN_WORDS_FOR_TITLE_IDENTITY:
            unkeyed.append(document)
            continue
        key = (document.conference, document.title.lower())
        kept = kept_by_key.get(key)
        if kept is None:
            kept_by_key[key] = document
            continue
        longer, shorter = (document, kept) if len(document.text) > len(kept.text) else (kept, document)
        longer.extra["duplicate_ids"] = longer.extra.get("duplicate_ids", []) + [shorter.id] + shorter.extra.get("duplicate_ids", [])
        kept_by_key[key] = longer
    return unkeyed + list(kept_by_key.values())


def corpus_report(documents: list[Document]) -> str:
    word_counts = [len(WORD.findall(document.text)) for document in documents]
    documents_by_group: dict[tuple, list[int]] = defaultdict(list)
    for document, word_count in zip(documents, word_counts):
        documents_by_group[(document.conference, document.source, document.track)].append(word_count)

    lines = ["# Corpus report", "", "| conference | source | track | documents | words | median words |", "|---|---|---|---|---|---|"]
    for (conference, source, track), counts in sorted(documents_by_group.items()):
        median = sorted(counts)[len(counts) // 2]
        lines.append(f"| {conference} | {source} | {track} | {len(counts)} | {sum(counts)} | {median} |")

    lines += ["", "## Totals by conference and source", "", "| conference | source | documents | words |", "|---|---|---|---|"]
    totals: Counter = Counter()
    document_totals: Counter = Counter()
    for document, word_count in zip(documents, word_counts):
        totals[(document.conference, document.source)] += word_count
        document_totals[(document.conference, document.source)] += 1
    for key in sorted(totals):
        lines.append(f"| {key[0]} | {key[1]} | {document_totals[key]} | {totals[key]} |")

    duplicate_titles = [title for title, count in Counter(d.title.lower() for d in documents).items() if count > 1]
    lines += ["", f"## Duplicate titles ({len(duplicate_titles)})", ""] + [f"- {title}" for title in sorted(duplicate_titles)[:50]]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
