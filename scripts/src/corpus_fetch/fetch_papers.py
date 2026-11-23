"""Add the full text of accepted entries that have an open-access arXiv preprint to data/interim/documents.jsonl
(cached, rate-limited per host). Run fetch-web first; re-running replaces the full texts from the previous run.

Run: uv run --project scripts fetch-papers [--seconds-between-requests HOST=SECONDS ...]
"""

from .documents import read_documents
from .fetch_web import DATA_DIR, DOCUMENTS_PATH, parse_arguments, polite_client, write_corpus
from .sources import arxiv_fulltext

FULLTEXT_MATCHES_PATH = DATA_DIR / "interim" / "fulltext_matches.tsv"


def main() -> None:
    client = polite_client(parse_arguments(__doc__))
    if not DOCUMENTS_PATH.exists():
        raise SystemExit(f"{DOCUMENTS_PATH} not found: run fetch-web first")
    documents = [document for document in read_documents(DOCUMENTS_PATH) if document.source != "fulltext"]
    documents += arxiv_fulltext.collect_documents(client, documents, FULLTEXT_MATCHES_PATH)
    write_corpus(documents)
    print(client.traffic_summary())


if __name__ == "__main__":
    main()
