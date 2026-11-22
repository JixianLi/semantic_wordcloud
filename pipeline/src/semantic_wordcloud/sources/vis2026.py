"""IEEE VIS 2026.

- accepted_entries: the static program listing (one page; each `article.program-card` carries the abstract in
  data attributes) plus the tutorials TSV in the website repo, which the listing does not include.
- keynote: Markdown pages of the invited speakers in the website repo, abstract sections only.
- website: Markdown sources of the website repo, filtered by config/vis2026_website_pages.tsv.

The website repo (ieee-vgtc/ieeevis.org, branch vis2026) is read through raw.githubusercontent.com, which avoids
crawling ieeevis.org (robots.txt asks for a 10 s crawl delay).
"""

import csv
import io
import re
from pathlib import Path

from bs4 import BeautifulSoup

from ..cached_http import CachedHttpClient
from ..documents import Document
from ..text_cleaning import drop_sections, markdown_to_text, normalize_whitespace

PROGRAM_LISTING_URL = "https://ieeevis.org/year/2026/program/content/"
PROGRAM_DETAIL_URL = "https://ieeevis.org/year/2026/program/content/{paper_id}"
REPO_RAW_URL = "https://raw.githubusercontent.com/ieee-vgtc/ieeevis.org/vis2026/"
SITE_PAGE_URL = "https://ieeevis.org/year/2026/{path}"
# Page -> whether its talk headings read "Speaker: Talk title" (VISions) rather than just the title.
KEYNOTE_PAGES = {
    "info/invited-speakers/keynote-speaker.md": False,
    "info/invited-speakers/capstone-speaker.md": False,
    "info/invited-speakers/visions.md": True,
}
# Card types that are not accepted entries: session chairs and the like, keynotes (taken from the speaker pages,
# which have the abstracts the listing lacks), and the awards plenary.
NON_ENTRY_CARD_TYPES = {"session-role", "invited-talk", "vis"}

ABSTRACT_MARKER = re.compile(r"^(#+\s*Abstract\s*$|\*\*Abstract:?\*\*:?)", re.IGNORECASE | re.MULTILINE)
SECTION_HEADING = re.compile(r"^#{2,3}\s+(.+)$", re.MULTILINE)
BIO_HEADING = re.compile(r"^(bio|about the speaker)", re.IGNORECASE)


def collect_documents(client: CachedHttpClient, config_dir: Path) -> list[Document]:
    return [
        *collect_program_entries(client),
        *collect_tutorials(client),
        *collect_keynotes(client),
        *collect_website_pages(client, config_dir / "vis2026_website_pages.tsv"),
    ]


def collect_program_entries(client: CachedHttpClient) -> list[Document]:
    soup = BeautifulSoup(client.get_text(PROGRAM_LISTING_URL), "lxml")
    documents = []
    for card in soup.select("article.program-card"):
        card_type = card.get("data-type", "")
        abstract = normalize_whitespace(card.get("data-abstract", ""))
        if card_type in NON_ENTRY_CARD_TYPES or not abstract:
            continue
        paper_id = card["data-paper-id"]
        detail_url = PROGRAM_DETAIL_URL.format(paper_id=paper_id)
        title_link = card.find("a", href=re.compile(re.escape(paper_id) + r"/?$"))
        title = title_link.get_text(" ", strip=True) if title_link else card.get("data-title", "")
        documents.append(Document(
            id=f"vis-{paper_id}",
            conference="vis",
            source="accepted_entries",
            track=card_type,
            title=title,
            url=detail_url,
            text=f"{title}.\n\n{abstract}",
            event=card.get("data-event", ""),
            extra={"keywords": card.get("data-keywords-label", ""), "session": card.get("data-session", ""),
                   "authors": [name.strip() for name in card.get("data-authors", "").split(",") if name.strip()]},
        ))
    return documents


def collect_tutorials(client: CachedHttpClient) -> list[Document]:
    tsv = client.get_text(REPO_RAW_URL + "src/data/early_program/tutorials_list.tsv")
    rows = list(csv.DictReader(io.StringIO(tsv), delimiter="\t"))
    documents = []
    for row in rows:
        title = row["tutorial_title"].strip()
        abstract = normalize_whitespace(row["description_abstract"])
        if not abstract:
            continue
        documents.append(Document(
            id=f"vis-{row['tutorial_id']}",
            conference="vis",
            source="accepted_entries",
            track="tutorial",
            title=title,
            url=SITE_PAGE_URL.format(path="info/program/tutorials"),
            text=f"{title}.\n\n{abstract}",
        ))
    return documents


def collect_keynotes(client: CachedHttpClient) -> list[Document]:
    documents = []
    for page_path, heading_has_speaker_prefix in KEYNOTE_PAGES.items():
        markdown = client.get_text(REPO_RAW_URL + "src/pages/" + page_path)
        talks = split_talk_abstracts(markdown, heading_has_speaker_prefix)
        for index_talk, (title, abstract) in enumerate(talks):
            documents.append(Document(
                id=f"vis-keynote-{Path(page_path).stem}-{index_talk}",
                conference="vis",
                source="keynote",
                track=Path(page_path).stem.removesuffix("-speaker"),
                title=title,
                url=SITE_PAGE_URL.format(path=page_path.removesuffix(".md")),
                text=f"{title}.\n\n{abstract}",
            ))
    return documents


def split_talk_abstracts(markdown: str, heading_has_speaker_prefix: bool) -> list[tuple[str, str]]:
    """(talk title, abstract) for each talk on a speaker page; bios are dropped.

    A page holds one or more `## [Speaker: ]Talk title` sections. Each has its abstract after a `**Abstract:**` lead
    or an `### Abstract` heading, and ends at the bio (`## About the Speaker` / `### Bio`) or the next talk.
    """
    talks = []
    headings = list(SECTION_HEADING.finditer(markdown))
    for index_heading, heading in enumerate(headings):
        heading_text = heading.group(1).strip()
        if BIO_HEADING.match(heading_text) or heading_text.lower() == "abstract":
            continue
        section_end = next(
            (later.start() for later in headings[index_heading + 1:]
             if not later.group(1).strip().lower() == "abstract"),
            len(markdown),
        )
        section = markdown[heading.end():section_end]
        marker = ABSTRACT_MARKER.search(section)
        if not marker:
            continue
        talk_title = heading_text.split(":", 1)[1].strip() if heading_has_speaker_prefix else heading_text
        talks.append((talk_title, markdown_to_text(section[marker.end():])))
    return talks


def collect_website_pages(client: CachedHttpClient, selection_path: Path) -> list[Document]:
    documents = []
    with selection_path.open() as file:
        for row in csv.DictReader(file, delimiter="\t"):
            if row["include"] != "yes":
                continue
            markdown = client.get_text(REPO_RAW_URL + "src/pages/" + row["path"])
            title_match = re.search(r'^title:\s*"?(.*?)"?\s*$', markdown, re.MULTILINE)
            documents.append(Document(
                id=f"vis-web-{row['path'].removesuffix('.md').replace('/', '-')}",
                conference="vis",
                source="website",
                track=row["category"],
                title=title_match.group(1) if title_match else row["path"],
                url=SITE_PAGE_URL.format(path=row["path"].removesuffix(".md")),
                text=markdown_to_text(drop_sections(markdown, row["drop_sections"].split(";"))),
            ))
    return documents
