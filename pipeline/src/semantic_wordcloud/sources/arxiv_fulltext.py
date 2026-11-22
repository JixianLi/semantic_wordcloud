"""Full text of accepted entries that have an open-access arXiv preprint.

Matching: entry titles are searched in batches of TITLES_PER_QUERY through the arXiv API (export.arxiv.org, which
asks for at most one request every 3 s). A result is the entry's preprint when
  - its normalized title (lowercase, letters and digits only) has a similarity ratio >= MIN_TITLE_SIMILARITY with the
    entry's (difflib; tolerates "visualisation"/"visualization" and subtitle punctuation),
  - it was first published on or after EARLIEST_PUBLICATION, and
  - it shares at least one author surname with the entry, when the entry lists authors.
Every match is written to data/interim/fulltext_matches.tsv for review.

Text: the arXiv HTML version (arxiv.org/html/<id>, LaTeXML) when it exists, else the PDF (arxiv.org/pdf/<id>,
extracted with pypdf). arxiv.org's robots.txt allows /html and /pdf with a 15 s crawl delay. Only the body is kept:
title, authors, abstract (the entry already has it, so keeping it would count it twice), acknowledgments,
references, math and equation tables are dropped; figure and table captions and appendices stay.
"""

import csv
import difflib
import io
import re
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ElementTree
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader

from ..cached_http import CachedHttpClient, NotFoundError
from ..documents import Document
from ..text_cleaning import normalize_whitespace, remove_urls_and_emails

API_URL = "https://export.arxiv.org/api/query?"
HTML_URL = "https://arxiv.org/html/{arxiv_id}"
PDF_URL = "https://arxiv.org/pdf/{arxiv_id}"
ABSTRACT_PAGE_URL = "https://arxiv.org/abs/{arxiv_id}"
ATOM = {"atom": "http://www.w3.org/2005/Atom"}

# Publication forms that can have a paper behind them; BoFs, panels, tutorials, exhibitor forums, art and demos
# are descriptions of sessions, not papers.
FULLTEXT_TRACKS = {
    "vis": {"full", "short", "tvcg", "cg&a", "workshop", "poster", "challenge"},
    "sc": {"Paper", "Gordon Bell Finalist", "Workshop Paper", "Research Poster", "ACM SRC Poster",
           "Doctoral Showcase", "Interactive e-Poster"},
}
TITLES_PER_QUERY = 10
MIN_TITLE_WORDS = 4
MIN_TITLE_SIMILARITY = 0.92
EARLIEST_PUBLICATION = "2025-01-01"
MIN_FULLTEXT_WORDS = 500

HTML_DROPPED = [".ltx_authors", ".ltx_abstract", ".ltx_acknowledgements", ".ltx_bibliography", ".ltx_TOC",
                ".ltx_page_navbar", ".ltx_dates", "math", ".ltx_equation", ".ltx_equationgroup", "nav", "footer",
                "script", "style", "img", "svg", ".ltx_tag_section", ".ltx_tag_subsection", "h1.ltx_title"]
PDF_BODY_START = re.compile(r"^\s*(\d+\.?\s+)?(introduction|motivation)\b", re.IGNORECASE | re.MULTILINE)
PDF_BODY_END = re.compile(r"^\s*(\d+\.?\s+)?(references|bibliography|acknowledg(e)?ments?)\s*$", re.IGNORECASE | re.MULTILINE)


def collect_documents(client: CachedHttpClient, entries: list[Document], matches_path: Path) -> list[Document]:
    candidates = [entry for entry in entries
                  if entry.source == "accepted_entries"
                  and entry.track in FULLTEXT_TRACKS[entry.conference]
                  and len(entry.title.split()) >= MIN_TITLE_WORDS]
    matches = find_preprints(client, candidates)
    write_matches(matches, matches_path)
    print(f"{len(matches)} of {len(candidates)} candidate entries have an arXiv preprint; fetching text ...")
    documents = []
    for entry, preprint in matches:
        text, form = fetch_body_text(client, preprint["id"])
        if len(text.split()) < MIN_FULLTEXT_WORDS:
            continue
        documents.append(Document(
            id=f"{entry.id}-fulltext",
            conference=entry.conference,
            source="fulltext",
            track=entry.track,
            title=entry.title,
            url=ABSTRACT_PAGE_URL.format(arxiv_id=preprint["id"]),
            text=text,
            event=entry.event,
            extra={"arxiv_id": preprint["id"], "text_from": form, "entry_id": entry.id},
        ))
    return documents


def normalized_title(title: str) -> str:
    folded = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", folded).split())


def surname(name: str) -> str:
    words = normalized_title(name).split()
    return words[-1] if words else ""


def find_preprints(client: CachedHttpClient, entries: list[Document]) -> list[tuple[Document, dict]]:
    matches, skipped_batches = [], 0
    for start in range(0, len(entries), TITLES_PER_QUERY):
        batch = entries[start:start + TITLES_PER_QUERY]
        query = " OR ".join(f'ti:"{normalized_title(entry.title)}"' for entry in batch)
        url = API_URL + urllib.parse.urlencode({"search_query": query, "max_results": 50})
        try:
            results = parse_atom(client.get_text(url))
        except httpx.HTTPError as error:
            skipped_batches += 1
            print(f"arXiv query failed after retries, batch skipped (re-run to retry it): {error}")
            continue
        for entry in batch:
            preprint = best_match(entry, results)
            if preprint:
                matches.append((entry, preprint))
    if skipped_batches:
        print(f"WARNING: {skipped_batches} title batches ({skipped_batches * TITLES_PER_QUERY} entries) were not searched")
    return matches


def parse_atom(xml: str) -> list[dict]:
    results = []
    for item in ElementTree.fromstring(xml).findall("atom:entry", ATOM):
        identifier = item.findtext("atom:id", "", ATOM)
        if "/abs/" not in identifier:
            continue
        results.append({
            "id": identifier.rsplit("/abs/", 1)[1],
            "title": " ".join(item.findtext("atom:title", "", ATOM).split()),
            "published": item.findtext("atom:published", "", ATOM)[:10],
            "authors": [author.findtext("atom:name", "", ATOM) for author in item.findall("atom:author", ATOM)],
        })
    return results


def best_match(entry: Document, results: list[dict]) -> dict | None:
    entry_title = normalized_title(entry.title)
    entry_surnames = {surname(name) for name in entry.extra.get("authors", [])} - {""}
    best, best_similarity = None, 0.0
    for result in results:
        similarity = difflib.SequenceMatcher(None, entry_title, normalized_title(result["title"])).ratio()
        if similarity < MIN_TITLE_SIMILARITY or result["published"] < EARLIEST_PUBLICATION:
            continue
        if entry_surnames and not entry_surnames & {surname(name) for name in result["authors"]}:
            continue
        if similarity > best_similarity:
            best, best_similarity = {**result, "similarity": similarity}, similarity
    return best


def write_matches(matches: list[tuple[Document, dict]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as file:
        writer = csv.writer(file, delimiter="\t")
        writer.writerow(["entry_id", "arxiv_id", "similarity", "published", "entry_title", "arxiv_title"])
        for entry, preprint in matches:
            writer.writerow([entry.id, preprint["id"], f"{preprint['similarity']:.3f}", preprint["published"],
                             entry.title, preprint["title"]])


def fetch_body_text(client: CachedHttpClient, arxiv_id: str) -> tuple[str, str]:
    try:
        text = html_body_text(client.get_text(HTML_URL.format(arxiv_id=arxiv_id)))
        if len(text.split()) >= MIN_FULLTEXT_WORDS:
            return text, "html"
    except (NotFoundError, httpx.HTTPStatusError):
        pass
    try:
        return pdf_body_text(client.get(PDF_URL.format(arxiv_id=arxiv_id))), "pdf"
    except Exception as error:  # HTTP errors, and pypdf raises assorted errors on malformed files
        print(f"no text for {arxiv_id}: {error}")
        return "", "none"


def html_body_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    article = soup.select_one("article") or soup.body
    if article is None:
        return ""
    for selector in HTML_DROPPED:
        for element in article.select(selector):
            element.decompose()
    return remove_urls_and_emails(normalize_whitespace(article.get_text("\n")))


def pdf_body_text(pdf_bytes: bytes) -> str:
    """Heuristic: the body runs from the first "Introduction" heading to "References"/"Acknowledgments"."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    start = PDF_BODY_START.search(text)
    text = text[start.start():] if start else text
    end = PDF_BODY_END.search(text)
    text = text[:end.start()] if end else text
    text = re.sub(r"-\n(?=[a-z])", "", text)  # rejoin words hyphenated across lines
    return remove_urls_and_emails(normalize_whitespace(text))
