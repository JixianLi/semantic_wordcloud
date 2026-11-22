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


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for element in soup(["script", "style", "iframe", "noscript", "svg", "img", "figure"]):
        element.decompose()
    return normalize_whitespace(soup.get_text("\n"))


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
