"""Fetch the Brown Corpus (the general-English background for BM25's IDF) into data/external/nltk_data, in the layout
NLTK reads. The zip comes from NLTK's data repository through the same cached, rate-limited client as the other
fetchers; nltk.download would fetch the same file, but outside that client.

Run: uv run --project scripts fetch-background [--seconds-between-requests HOST=SECONDS ...]
"""

import zipfile

from .fetch_web import DATA_DIR, parse_arguments, polite_client

NLTK_DATA_DIR = DATA_DIR / "external" / "nltk_data"
BROWN_ZIP_URL = "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/brown.zip"


def main() -> None:
    client = polite_client(parse_arguments(__doc__))
    corpora_dir = NLTK_DATA_DIR / "corpora"
    corpora_dir.mkdir(parents=True, exist_ok=True)
    zip_path = corpora_dir / "brown.zip"
    zip_path.write_bytes(client.get(BROWN_ZIP_URL))
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(corpora_dir)
    print(f"Brown Corpus -> {corpora_dir / 'brown'}")
    print(client.traffic_summary())


if __name__ == "__main__":
    main()
