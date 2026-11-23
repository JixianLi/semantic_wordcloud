import re

from bs4 import BeautifulSoup

FRONTMATTER = re.compile(r"\A---\n.*?\n---\n", re.DOTALL)
MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
MARKDOWN_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
BARE_URL = re.compile(r"https?://\S+")
EMAIL = re.compile(r"\S+@\S+\.\w+")
MARKDOWN_SYNTAX = re.compile(r"(^#{1,6}\s*|\*\*|__|(?<!\w)[*_](?!\s)|^\s*[-*+]\s+|^\s*\d+\.\s+|^>\s*|`)", re.MULTILINE)
BLANK_RUNS = re.compile(r"\n\s*\n+")
SPACE_RUNS = re.compile(r"[ \t]+")


HEADING_LINE = re.compile(r"^(#{1,6})\s+(.*)$")
BOLD_LABEL_LINE = re.compile(r"^\*\*(.+?):?\*\*:?\s*$")


def html_to_text(html: str, mark_headings: bool = False) -> str:
    """Visible text of an HTML fragment; with mark_headings, each <hN> line starts with N '#' so drop_sections can
    see the document structure."""
    soup = BeautifulSoup(html, "lxml")
    for element in soup(["script", "style", "iframe", "noscript", "svg", "img", "figure"]):
        element.decompose()
    if mark_headings:
        for heading in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
            # Replace the content with one string: get_text("\n") would otherwise put the marks and nested text
            # on separate lines.
            heading.string = "\n" + "#" * int(heading.name[1]) + " " + heading.get_text(" ", strip=True) + "\n"
    return normalize_whitespace(soup.get_text("\n"))


def drop_sections(text: str, section_names: list[str]) -> str:
    """Remove named sections from markdown-like text (markdown, or html_to_text(..., mark_headings=True)).

    A section starts at a heading line ("## Name") or a bold label line ("**Name:**") whose name matches one of
    section_names (case-insensitive). A heading section runs to the next heading of the same or a higher level; a label
    section runs to the next heading of any level.
    """
    wanted = {name.strip().lower() for name in section_names if name.strip()}
    if not wanted:
        return text
    kept_lines = []
    dropping_until_level = None  # 7 = any heading ends the section
    for line in text.split("\n"):
        heading = HEADING_LINE.match(line.strip())
        if heading and dropping_until_level is not None and len(heading.group(1)) <= dropping_until_level:
            dropping_until_level = None
        if dropping_until_level is None:
            label = BOLD_LABEL_LINE.match(line.strip())
            if heading and heading.group(2).strip().rstrip(":").lower() in wanted:
                dropping_until_level = len(heading.group(1))
            elif label and label.group(1).strip().lower() in wanted:
                dropping_until_level = 7
        if dropping_until_level is None:
            kept_lines.append(line)
    return "\n".join(kept_lines)


def strip_heading_marks(text: str) -> str:
    return re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)


def strip_frontmatter(markdown: str) -> str:
    return FRONTMATTER.sub("", markdown, count=1)


def markdown_to_text(markdown: str) -> str:
    text = strip_frontmatter(markdown)
    text = MARKDOWN_IMAGE.sub("", text)
    text = MARKDOWN_LINK.sub(r"\1", text)
    text = html_to_text(text) if "<" in text else text
    text = MARKDOWN_SYNTAX.sub("", text)
    return remove_urls_and_emails(normalize_whitespace(text))


def remove_urls_and_emails(text: str) -> str:
    return EMAIL.sub("", BARE_URL.sub("", text))


def normalize_whitespace(text: str) -> str:
    lines = [SPACE_RUNS.sub(" ", line).strip() for line in text.replace("\r", "").split("\n")]
    return BLANK_RUNS.sub("\n\n", "\n".join(lines)).strip()
