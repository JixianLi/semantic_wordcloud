"""Stage 2: terms, phrases, background IDF from the Brown Corpus, BM25 weights, and the web export.

Run: uv run build-terms   (needs data/interim/documents.jsonl from collect-corpus)

BM25 term weight (Robertson & Zaragoza 2009, "The Probabilistic Relevance Framework: BM25 and Beyond"):
    w(t, d) = idf_bg(t) · tf(t,d)·(k1 + 1) / (tf(t,d) + k1·(1 − b + b·|d|/avgdl))
    idf_bg(t) = ln((N_bg − df_bg(t) + 0.5) / (df_bg(t) + 0.5) + 1)
  tf(t,d)   occurrences of term t in document d (after phrase merging)
  |d|       number of term occurrences in d; avgdl their mean over our corpus
  N_bg      documents in the background corpus (Brown: 500 samples)
  df_bg(t)  background documents containing t
  k1 = 1.2 (tf saturation), b = 0.75 (length normalization)
The IDF comes from general English, not from our own documents, so a term is weighted by how unusual it is in
everyday text; the client sums w(t, d) over the selected documents.

Phrase association, NPMI generalized to n tokens (Bouma 2009 for n = 2):
    npmi(g) = ln(p(g) / Π p(w_i)) / ((n − 1) · −ln p(g))
  p(g)   occurrences of the n-gram / number of n-token windows; p(w_i) occurrences of token i / number of tokens
It is 1 when the tokens only ever occur together and 0 when they co-occur by chance.
"""

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import nltk

from .collect_corpus import CONFIG_DIR, DATA_DIR, DOCUMENTS_PATH
from .documents import read_documents
from .tokenize_corpus import display_form, load_language, read_term_list, term_key, word_tokens

BM25_K1 = 1.2
BM25_B = 0.75
MAX_PHRASE_TOKENS = 3
MIN_PHRASE_NPMI = 0.3
MIN_PHRASE_DOCUMENT_FREQUENCY = 3
MIN_TERM_DOCUMENT_FREQUENCY = 2
MIN_ENTITY_SHARE = 0.5
MAX_TERMS_PER_DOCUMENT = 200
NLTK_DATA_DIR = DATA_DIR / "external" / "nltk_data"
TERM_TOKENS_PATH = DATA_DIR / "interim" / "term_tokens.jsonl"
REPORT_PATH = DATA_DIR / "interim" / "terms_report.md"
EXPORT_PATH = Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "corpus.json"


def main() -> None:
    documents = read_documents(DOCUMENTS_PATH)
    stop_terms, stop_exceptions = read_term_list(CONFIG_DIR / "stop_terms.txt")
    entity_allowlist, _ = read_term_list(CONFIG_DIR / "entity_allowlist.txt")
    language = load_language()

    print("tokenizing corpus ...")
    tokens_by_document = [word_tokens(doc) for doc in language.pipe((d.text for d in documents), batch_size=64)]
    lemma_by_lowercase_text = learn_lemmas(tokens_by_document)
    keyed_by_document = [[(token, term_key(token, lemma_by_lowercase_text)) for token in tokens] for tokens in tokens_by_document]
    name_keys = keys_mostly_used_as_names(keyed_by_document, entity_allowlist)
    dropped_entity_counts = Counter(key for keyed in keyed_by_document for token, key in keyed if token.in_name_entity and key in name_keys)
    runs_by_document = [token_runs(keyed, name_keys) for keyed in keyed_by_document]

    phrases = select_phrases(runs_by_document)
    term_sequences = [[term for term in merge_phrases(runs, phrases) if not is_stopped(term.key, stop_terms, stop_exceptions)]
                      for runs in runs_by_document]

    document_frequency = Counter(key for sequence in term_sequences for key in {term.key for term in sequence})
    vocabulary = sorted(key for key, count in document_frequency.items() if count >= MIN_TERM_DOCUMENT_FREQUENCY)
    index_by_key = {key: index for index, key in enumerate(vocabulary)}
    term_sequences = [[term for term in sequence if term.key in index_by_key] for sequence in term_sequences]
    print(f"{len(vocabulary)} terms, {sum(' ' in key for key in vocabulary)} of them phrases")

    print("background document frequencies from Brown ...")
    background_df, background_size = brown_document_frequencies(vocabulary, lemma_by_lowercase_text)
    idf = {key: background_idf(background_df.get(key, 0), background_size) for key in vocabulary}

    weights_by_document = bm25_weights(term_sequences, idf)
    display_by_key = most_common_display(term_sequences)
    write_term_tokens(documents, term_sequences, index_by_key)
    export_corpus(documents, vocabulary, display_by_key, idf, background_df, document_frequency, term_sequences,
                  weights_by_document, index_by_key)
    REPORT_PATH.write_text(terms_report(documents, vocabulary, display_by_key, background_df, weights_by_document,
                                        dropped_entity_counts, phrases))
    print(f"export -> {EXPORT_PATH}\nreport -> {REPORT_PATH}")


class Term:
    __slots__ = ("key", "display", "sentence")

    def __init__(self, key: str, display: str, sentence: int):
        self.key, self.display, self.sentence = key, display, sentence


def learn_lemmas(tokens_by_document) -> dict[str, str]:
    counts: dict[str, Counter] = defaultdict(Counter)
    for tokens in tokens_by_document:
        for token in tokens:
            if token.part_of_speech != "PROPN":
                counts[token.text.lower()][token.lemma] += 1
    return {text: lemmas.most_common(1)[0][0] for text, lemmas in counts.items()}


def keys_mostly_used_as_names(keyed_by_document, entity_allowlist) -> set[str]:
    """Keys tagged person/place/nationality in at least MIN_ENTITY_SHARE of their occurrences. A key below the share
    ("ai": tagged a person sometimes, a term mostly) is a tagging error, so none of its occurrences are dropped."""
    entity_count, total_count = Counter(), Counter()
    for keyed in keyed_by_document:
        for token, key in keyed:
            total_count[key] += 1
            entity_count[key] += token.in_name_entity
    return {key for key, count in entity_count.items()
            if count / total_count[key] >= MIN_ENTITY_SHARE and key not in entity_allowlist}


def token_runs(keyed, name_keys) -> list[list[tuple]]:
    """Runs of (key, display, sentence, separator) for directly adjacent kept tokens. A run breaks wherever a word
    was dropped in between, so phrases never span a gap ("data of visualization" is not "data visualization")."""
    runs, current_run, previous_index = [], [], None
    for index_token, (token, key) in enumerate(keyed):
        if token.in_name_entity and key in name_keys:
            continue
        continues_run = current_run and token.separator_from_previous and previous_index == index_token - 1
        if current_run and not continues_run:
            runs.append(current_run)
            current_run = []
        current_run.append((key, display_form(token, key), token.sentence, token.separator_from_previous if current_run else ""))
        previous_index = index_token
    if current_run:
        runs.append(current_run)
    return runs


def is_stopped(key: str, stop_terms: set[str], stop_exceptions: set[str]) -> bool:
    """A term is dropped if it is on the stoplist, or is a phrase containing a stoplisted word ("poster session"),
    unless it is a listed exception ("+job submission")."""
    if key in stop_terms:
        return True
    return " " in key and key not in stop_exceptions and any(word in stop_terms for word in key.split(" "))


def select_phrases(runs_by_document) -> set[tuple[str, ...]]:
    token_counts: Counter = Counter()
    ngram_counts: dict[int, Counter] = {n: Counter() for n in range(2, MAX_PHRASE_TOKENS + 1)}
    ngram_documents: dict[tuple, set[int]] = defaultdict(set)
    for index_document, runs in enumerate(runs_by_document):
        for run in runs:
            keys = [key for key, _, _, _ in run]
            token_counts.update(keys)
            for n in ngram_counts:
                for start in range(len(keys) - n + 1):
                    ngram = tuple(keys[start:start + n])
                    if len(set(ngram)) < n:
                        continue
                    ngram_counts[n][ngram] += 1
                    ngram_documents[ngram].add(index_document)
    total_tokens = sum(token_counts.values())
    phrases = set()
    for n, counts in ngram_counts.items():
        total_windows = sum(counts.values())
        for ngram, count in counts.items():
            if len(ngram_documents[ngram]) < MIN_PHRASE_DOCUMENT_FREQUENCY:
                continue
            probability = count / total_windows
            independent = math.prod(token_counts[key] / total_tokens for key in ngram)
            npmi = math.log(probability / independent) / ((n - 1) * -math.log(probability))
            if npmi >= MIN_PHRASE_NPMI:
                phrases.add(ngram)
    return phrases


def merge_phrases(runs, phrases: set[tuple[str, ...]]) -> list[Term]:
    """Greedy longest match within each run: a phrase consumes its tokens, so they no longer count as unigrams."""
    terms = []
    for run in runs:
        index_token = 0
        while index_token < len(run):
            for length in range(min(MAX_PHRASE_TOKENS, len(run) - index_token), 0, -1):
                window = run[index_token:index_token + length]
                keys = tuple(key for key, _, _, _ in window)
                if length == 1 or keys in phrases:
                    display = "".join((joiner if offset else "") + shown for offset, (_, shown, _, joiner) in enumerate(window))
                    terms.append(Term(" ".join(keys), display, window[0][2]))
                    index_token += length
                    break
    return terms


def brown_document_frequencies(vocabulary, lemma_by_lowercase_text) -> tuple[Counter, int]:
    """Background df of every vocabulary term: Brown samples containing it, with the same word filter and keys as the
    corpus. A phrase counts when its words appear directly adjacent."""
    nltk.data.path.insert(0, str(NLTK_DATA_DIR))
    nltk.download("brown", download_dir=str(NLTK_DATA_DIR), quiet=True)
    from nltk.corpus import brown

    language = load_language(with_parser_and_entities=False)
    vocabulary_set = set(vocabulary)
    texts = (" ".join(brown.words(fileid)) for fileid in brown.fileids())
    background_df: Counter = Counter()
    for doc in language.pipe(texts, batch_size=16):
        keyed = [(token, term_key(token, lemma_by_lowercase_text)) for token in word_tokens(doc)]
        present = set()
        for run in token_runs(keyed, name_keys=set()):
            keys = [key for key, _, _, _ in run]
            for n in range(1, MAX_PHRASE_TOKENS + 1):
                for start in range(len(keys) - n + 1):
                    present.add(" ".join(keys[start:start + n]))
        background_df.update(present & vocabulary_set)
    return background_df, len(brown.fileids())


def background_idf(document_frequency: int, background_size: int) -> float:
    return math.log((background_size - document_frequency + 0.5) / (document_frequency + 0.5) + 1)


def bm25_weights(term_sequences, idf) -> list[dict[str, float]]:
    lengths = [len(sequence) for sequence in term_sequences]
    average_length = sum(lengths) / max(1, sum(1 for length in lengths if length))
    weights_by_document = []
    for sequence, length in zip(term_sequences, lengths):
        term_frequency = Counter(term.key for term in sequence)
        length_factor = BM25_K1 * (1 - BM25_B + BM25_B * length / average_length)
        weights = {key: idf[key] * count * (BM25_K1 + 1) / (count + length_factor) for key, count in term_frequency.items()}
        top = sorted(weights.items(), key=lambda item: -item[1])[:MAX_TERMS_PER_DOCUMENT]
        weights_by_document.append(dict(top))
    return weights_by_document


def most_common_display(term_sequences) -> dict[str, str]:
    """Most common surface form. A form whose only capitals are word-initial ("Visual Analytics" from titles, "Visual
    analytics" at a sentence start) counts as its lowercase form when that also occurs, so headline casing does not
    win; acronyms and names ("NVIDIA", "SCinet", "Gaussian") keep their case."""
    display_counts: dict[str, Counter] = defaultdict(Counter)
    for sequence in term_sequences:
        for term in sequence:
            display_counts[term.key][term.display] += 1
    display_by_key = {}
    for key, counts in display_counts.items():
        folded: Counter = Counter()
        for form, count in counts.items():
            lowercase = form.lower()
            only_initial_capitals = all(word[1:] == word[1:].lower() for word in form.replace("-", " ").split(" "))
            folded[lowercase if only_initial_capitals and lowercase in counts else form] += count
        display_by_key[key] = folded.most_common(1)[0][0]
    return display_by_key


def write_term_tokens(documents, term_sequences, index_by_key) -> None:
    """Per document, its term sequence as [term index, sentence index] pairs, for the semantics stage."""
    with TERM_TOKENS_PATH.open("w") as file:
        for document, sequence in zip(documents, term_sequences):
            pairs = [[index_by_key[term.key], term.sentence] for term in sequence]
            file.write(json.dumps({"id": document.id, "terms": pairs}) + "\n")


def export_corpus(documents, vocabulary, display_by_key, idf, background_df, document_frequency, term_sequences,
                  weights_by_document, index_by_key) -> None:
    """web/public/data/corpus.json; its shape:
    terms:     [{key, display, tokens, idf, background_df, df}]   df = documents in our corpus containing the term
    documents: [{id, conference, source, track, title, url, term_count, term_indices, weights}]
               term_count = term occurrences in the document (the venue balance uses their sum);
               term_indices/weights = the document's top MAX_TERMS_PER_DOCUMENT BM25 weights, parallel arrays
    """
    terms = [{
        "key": key,
        "display": display_by_key.get(key, key),
        "tokens": key.count(" ") + 1,
        "idf": round(idf[key], 4),
        "background_df": background_df.get(key, 0),
        "df": document_frequency[key],
    } for key in vocabulary]
    exported_documents = []
    for document, sequence, weights in zip(documents, term_sequences, weights_by_document):
        exported_documents.append({
            "id": document.id,
            "conference": document.conference,
            "source": document.source,
            "track": document.track,
            "title": document.title,
            "url": document.url,
            "term_count": len(sequence),
            "term_indices": [index_by_key[key] for key in weights],
            "weights": [round(weight, 4) for weight in weights.values()],
        })
    EXPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    EXPORT_PATH.write_text(json.dumps({"bm25": {"k1": BM25_K1, "b": BM25_B, "background": "Brown Corpus (500 samples)"},
                                       "terms": terms, "documents": exported_documents}, ensure_ascii=False, separators=(",", ":")))


def terms_report(documents, vocabulary, display_by_key, background_df, weights_by_document, dropped_entity_counts, phrases) -> str:
    def top_terms(selected_indices, count=40, only_unseen_in_background=False):
        scores: Counter = Counter()
        for index_document in selected_indices:
            for key, weight in weights_by_document[index_document].items():
                if only_unseen_in_background and background_df.get(key, 0):
                    continue
                scores[key] += weight
        return ", ".join(f"{display_by_key.get(key, key)} ({score:.0f})" for key, score in scores.most_common(count))

    indices_where = lambda predicate: [index for index, document in enumerate(documents) if predicate(document)]
    lines = ["# Terms report", "", f"Vocabulary: {len(vocabulary)} terms, of which {sum(' ' in key for key in vocabulary)} phrases "
             f"({len(phrases)} phrases passed NPMI before the document-frequency cut).", ""]
    for title, predicate in [
        ("VIS, all sources", lambda d: d.conference == "vis"),
        ("SC, all sources", lambda d: d.conference == "sc"),
        ("VIS accepted entries", lambda d: d.conference == "vis" and d.source == "accepted_entries"),
        ("SC accepted entries", lambda d: d.conference == "sc" and d.source == "accepted_entries"),
        ("VIS website", lambda d: d.conference == "vis" and d.source == "website"),
        ("SC website", lambda d: d.conference == "sc" and d.source == "website"),
    ]:
        lines += [f"## Top terms: {title}", "", top_terms(indices_where(predicate)), ""]
    lines += ["## Highest-scoring terms Brown has never seen (check for modern everyday words)", "",
              "Website pages: " + top_terms(indices_where(lambda d: d.source == "website"), 60, True), "",
              "Everything: " + top_terms(range(len(documents)), 60, True), ""]
    lines += ["## Most frequent lemmas dropped as named entities (add false positives to config/entity_allowlist.txt)", "",
              ", ".join(f"{key} ({count})" for key, count in dropped_entity_counts.most_common(80)), ""]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
