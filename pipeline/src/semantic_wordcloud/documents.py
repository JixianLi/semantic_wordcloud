import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

Conference = Literal["vis", "sc"]
Source = Literal["accepted_entries", "fulltext", "keynote", "website"]


@dataclass
class Document:
    id: str
    conference: Conference
    source: Source
    # Publication form within the source, e.g. "full", "short", "poster", "workshop_paper", "bof"; for website pages
    # the page category from config/website_pages.tsv.
    track: str
    title: str
    url: str
    # Only what people talk about: no authors, affiliations, bios, or session metadata.
    text: str
    # Grouping that is not content, kept for filters and inspection (e.g. workshop name, session title).
    event: str = ""
    extra: dict = field(default_factory=dict)


def write_documents(documents: list[Document], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as file:
        for document in documents:
            file.write(json.dumps(asdict(document), ensure_ascii=False) + "\n")


def read_documents(path: Path) -> list[Document]:
    with path.open() as file:
        return [Document(**json.loads(line)) for line in file]
