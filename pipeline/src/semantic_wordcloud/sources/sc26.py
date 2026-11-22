"""SC26.

- accepted_entries and keynote: the Linklings program at sc26.conference-program.com. Its front page is a JS shell
  that loads one static HTML fragment per day; those, plus the posters page, list the sessions, and each session page
  lists its presentations (workshop papers appear only there). Each presentation's ICS export has its abstract, and
  config/sc26_presentation_types.tsv maps its ID prefix to a source (accepted_entries, keynote, excluded) and a track.
- website: the WordPress REST API of sc26.supercomputing.org, filtered by config/sc26_website_pages.tsv. The one page
  in category "nre_demos" is a list of accepted Network Research Exhibition demos; it is split into one
  accepted_entries document per demo instead.
"""

import csv
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup
from icalendar import Calendar

from ..cached_http import CachedHttpClient
from ..documents import Document
from ..text_cleaning import drop_sections, html_to_text, normalize_whitespace, remove_urls_and_emails, strip_heading_marks

PROGRAM_HOST = "https://sc26.conference-program.com"
DAY_FRAGMENT_URL = PROGRAM_HOST + "/wp-content/linklings_snippets/wp_program_view_all_2026-11-{day:02d}.txt"
PROGRAM_DAYS = range(14, 21)
POSTERS_URL = PROGRAM_HOST + "/posters/"
SESSION_URL = PROGRAM_HOST + "/session/?sess={session_id}"
PRESENTATION_URL = PROGRAM_HOST + "/presentation/?id={presentation_id}&sess={session_id}"
CALENDAR_URL = PROGRAM_HOST + "/wp-content/plugins/linklings_wp_program/get_cal/?id={session_id}--{presentation_id}"
WEBSITE_API_URL = "https://sc26.supercomputing.org/wp-json/wp/v2/{kind}?per_page=100&page={page}"

NRE_DEMO_MARKER = re.compile(r"^SC26-NRE-(\d+)")
PRESENTATION_LINK = re.compile(r"[?&]id=([a-z_]+\d+)&(?:amp;)?sess=(sess\d+)")
SESSION_LINK = re.compile(r"[?&]sess=(sess\d+)")
PRESENTATION_PREFIX = re.compile(r"[a-z_]+?(?=\d)")
METADATA_PARAGRAPH = re.compile(r"^[A-Z][A-Za-z/&() -]{1,40}:\s")


def collect_documents(client: CachedHttpClient, config_dir: Path) -> list[Document]:
    type_by_prefix = read_presentation_types(config_dir / "sc26_presentation_types.tsv")
    documents = []
    for presentation in collect_presentations(client):
        presentation_type = type_by_prefix.get(presentation_prefix(presentation["presentation_id"]))
        if presentation_type is None or presentation_type["source"] == "excluded" or not presentation["abstract"]:
            continue
        documents.append(presentation_document(presentation, presentation_type["source"], presentation_type["track"]))
    documents.extend(collect_website_pages(client, config_dir / "sc26_website_pages.tsv"))
    return documents


def read_presentation_types(path: Path) -> dict[str, dict]:
    with path.open() as file:
        return {row["prefix"]: row for row in csv.DictReader(file, delimiter="\t")}


def presentation_prefix(presentation_id: str) -> str:
    """ID prefix naming the presentation type: "pap234" -> "pap"; every workshop paper "ws_<acronym>N" -> "ws_"."""
    if presentation_id.startswith("ws_"):
        return "ws_"
    return PRESENTATION_PREFIX.match(presentation_id).group(0)


def collect_presentations(client: CachedHttpClient) -> list[dict]:
    """Every presentation reachable from the program, each once (a presentation can sit in several sessions)."""
    session_by_presentation: dict[str, str] = {}
    session_title_by_id: dict[str, str] = {}
    for session_id in sorted(enumerate_session_ids(client)):
        session_html = client.get_text(SESSION_URL.format(session_id=session_id))
        session_title_by_id[session_id] = parse_session_title(session_html)
        for presentation_id, linked_session_id in PRESENTATION_LINK.findall(session_html):
            session_by_presentation.setdefault(presentation_id, linked_session_id)
    presentations = []
    for presentation_id, session_id in sorted(session_by_presentation.items()):
        presentation = parse_calendar_entry(client, presentation_id, session_id)
        presentation["session_title"] = session_title_by_id.get(session_id, "")
        presentations.append(presentation)
    return presentations


def enumerate_session_ids(client: CachedHttpClient) -> set[str]:
    listing_urls = [DAY_FRAGMENT_URL.format(day=day) for day in PROGRAM_DAYS] + [POSTERS_URL]
    session_ids = set()
    for url in listing_urls:
        session_ids.update(SESSION_LINK.findall(client.get_text(url)))
    return session_ids


def parse_session_title(session_html: str) -> str:
    title = BeautifulSoup(session_html, "lxml").select_one(".session-title")
    return normalize_whitespace(title.get_text(" ")) if title else ""


def parse_calendar_entry(client: CachedHttpClient, presentation_id: str, session_id: str) -> dict:
    """Title, abstract and tags from the presentation's ICS export.

    Its DESCRIPTION is paragraphs: the people ("Name, Name (Affiliation)"; absent for breaks and ceremonies), the
    abstract, then labelled metadata ("Tag: ...", "Recording: ...", "Session Chairs: ..."). Only the abstract is kept.
    The ICS is used rather than the presentation page because the page takes ~3.7 s to render, the ICS ~0.2 s.
    """
    ics_text = client.get_text(CALENDAR_URL.format(session_id=session_id, presentation_id=presentation_id))
    calendar = Calendar.from_ical(ics_text)
    event = next(iter(calendar.walk("VEVENT")), None)
    title = str(event.get("SUMMARY", "")) if event else ""
    paragraphs = [paragraph.strip() for paragraph in str(event.get("DESCRIPTION", "") if event else "").split("\n\n")]
    paragraphs = [paragraph for paragraph in paragraphs if paragraph]
    tags = [paragraph.split(":", 1)[1].strip() for paragraph in paragraphs if paragraph.startswith("Tag:")]
    content = [paragraph for paragraph in paragraphs if not METADATA_PARAGRAPH.match(paragraph)]
    authors = []
    if content and is_people_paragraph(content[0]):
        authors = people_names(content[0])
        content = content[1:]
    return {
        "presentation_id": presentation_id,
        "session_id": session_id,
        "url": PRESENTATION_URL.format(presentation_id=presentation_id, session_id=session_id),
        "title": normalize_whitespace(title),
        "abstract": remove_urls_and_emails(normalize_whitespace("\n\n".join(content))),
        "tags": tags,
        "authors": authors,
    }


def is_people_paragraph(paragraph: str) -> bool:
    """ "Name, Name (Affiliation), and Name": ends with an affiliation, or, when the last person has none, has an
    affiliation and no sentence ending. Abstracts end with sentence punctuation."""
    if paragraph.endswith(")"):
        return True
    return "(" in paragraph and not paragraph.endswith((".", "!", "?", ":", '"', "”")) and len(paragraph) < 600


def people_names(paragraph: str) -> list[str]:
    """Names from "A, B (Affiliation); C and D (Affiliation)": affiliations removed, split on , ; and "and"."""
    without_affiliations = re.sub(r"\([^()]*(\([^()]*\))?[^()]*\)", "", paragraph)
    parts = re.split(r",|;|\band\b", without_affiliations)
    return [part.strip() for part in parts if part.strip()]


def presentation_document(presentation: dict, source: str, track: str) -> Document:
    return Document(
        id=f"sc-{presentation['presentation_id']}",
        conference="sc",
        source=source,
        track=track,
        title=presentation["title"],
        url=presentation["url"],
        text=f"{presentation['title']}.\n\n{presentation['abstract']}",
        event=presentation["session_title"],
        extra={"tags": presentation["tags"], "authors": presentation["authors"]},
    )


def fetch_website_items(client: CachedHttpClient) -> list[dict]:
    items = []
    for kind in ("pages", "posts"):
        page = 1
        while True:
            batch = json.loads(client.get(WEBSITE_API_URL.format(kind=kind, page=page)))
            items.extend({"kind": kind, **item} for item in batch)
            if len(batch) < 100:
                break
            page += 1
    return items


def collect_website_pages(client: CachedHttpClient, selection_path: Path) -> list[Document]:
    with selection_path.open() as file:
        row_by_link = {row["link"]: row for row in csv.DictReader(file, delimiter="\t") if row["include"] == "yes"}
    documents = []
    for item in fetch_website_items(client):
        row = row_by_link.get(item["link"])
        if row is None:
            continue
        if row["category"] == "nre_demos":
            documents.extend(split_nre_demos(item))
            continue
        marked_text = html_to_text(item["content"]["rendered"], mark_headings=True)
        text = strip_heading_marks(drop_sections(marked_text, row["drop_sections"].split(";")))
        documents.append(Document(
            id=f"sc-web-{item['kind']}-{item['id']}",
            conference="sc",
            source="website",
            track=row["category"],
            title=html_to_text(item["title"]["rendered"]),
            url=item["link"],
            text=remove_urls_and_emails(text),
        ))
    return documents


def split_nre_demos(item: dict) -> list[Document]:
    """The accepted-demos page repeats: "SC26-NRE-<n> PDF", the demo title in <strong>, a "<Org>, Booth #<n>" line,
    then the abstract paragraphs. The intro before the first marker and the booth lines are dropped."""
    paragraphs = [paragraph.get_text(" ", strip=True) for paragraph in BeautifulSoup(item["content"]["rendered"], "lxml").find_all("p")]
    demos: list[tuple[str, list[str]]] = []
    for paragraph in paragraphs:
        marker = NRE_DEMO_MARKER.match(paragraph)
        if marker:
            demos.append((marker.group(1), []))
        elif demos and paragraph and "Booth #" not in paragraph:
            demos[-1][1].append(paragraph)
    documents = []
    for demo_number, demo_paragraphs in demos:
        if not demo_paragraphs:
            continue
        title, abstract = demo_paragraphs[0], "\n\n".join(demo_paragraphs[1:])
        documents.append(Document(
            id=f"sc-nre{demo_number}",
            conference="sc",
            source="accepted_entries",
            track="NRE Demo",
            title=title,
            url=item["link"],
            text=remove_urls_and_emails(normalize_whitespace(f"{title}.\n\n{abstract}")),
        ))
    return documents
