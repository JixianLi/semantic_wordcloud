"""Stage 3: term-term similarity, two ways, for the semantic layout.

Run: uv run build-semantics   (needs build-terms output: corpus.json and data/interim/term_tokens.jsonl)

1. Co-occurrence: NPMI of two terms over sentences (Bouma 2009),
       npmi(x, y) = ln(p(x,y) / (p(x) p(y))) / −ln p(x,y)
   p(x) = sentences containing x / all sentences; p(x,y) = sentences containing both. 1 means the terms only ever
   occur together, 0 independence; negatives are clipped to 0. A pair must co-occur in at least
   MIN_COOCCURRENCE_DOCUMENTS different documents, so one long page cannot make its own vocabulary look related
   (before this rule, "LLM" was nearest to "scientific misconduct", all from one policy page).
2. Contextual embedding: each sentence is embedded with EMBEDDING_MODEL, the corpus-mean sentence vector is
   subtracted, and a term's vector is the mean of the centered vectors of the sentences it occurs in; similarity is
   cosine. Meaning comes from how this corpus uses a term ("Morse" lands near "saddle" and "scalar field"), unlike
   embedding the bare term text, which mostly measured spelling ("LLM" was nearest to "LLVM"). Centering removes
   the component shared by all sentences; without it, generic words that occur everywhere ("novel", "based") average
   to the corpus mean and sit near every term (Mu & Viswanath 2018, "All-but-the-Top").

Each measure is divided by its 99th percentile over the exported neighbor values and capped at 1, so a UI blend
α·embedding + (1 − α)·co-occurrence mixes comparable scales.

Output: web/public/data/neighbors.json
    model: str, terms: [term index into corpus.json terms]   (the terms that have neighbor lists)
    cooccurrence / embedding: [[neighbor term indices], [similarities 0..1]] per listed term, best first
"""

import json
from collections import Counter, defaultdict
from itertools import combinations

import numpy as np
from sentence_transformers import SentenceTransformer

from .build_terms import EXPORT_PATH as CORPUS_PATH, TERM_TOKENS_PATH

EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
MIN_TERM_DOCUMENT_FREQUENCY = 3
MIN_COOCCURRENCE_SENTENCES = 3
MIN_COOCCURRENCE_DOCUMENTS = 3
NEIGHBORS_PER_TERM = 30
NORMALIZING_PERCENTILE = 99
NEIGHBORS_PATH = CORPUS_PATH.parent / "neighbors.json"


def main() -> None:
    corpus = json.loads(CORPUS_PATH.read_text())
    terms = corpus["terms"]
    listed = [index for index, term in enumerate(terms) if term["df"] >= MIN_TERM_DOCUMENT_FREQUENCY]
    print(f"{len(listed)} terms with df >= {MIN_TERM_DOCUMENT_FREQUENCY}")
    documents = [json.loads(line) for line in TERM_TOKENS_PATH.open()]

    cooccurrence = cooccurrence_neighbors(documents, set(listed))
    embedding = contextual_embedding_neighbors(documents, listed)
    normalize(cooccurrence)
    normalize(embedding)

    NEIGHBORS_PATH.write_text(json.dumps({
        "model": EMBEDDING_MODEL,
        "terms": listed,
        "cooccurrence": [pack(cooccurrence.get(index, [])) for index in listed],
        "embedding": [pack(embedding.get(index, [])) for index in listed],
    }, separators=(",", ":")))
    print(f"neighbors -> {NEIGHBORS_PATH}")
    print_examples(terms, cooccurrence, embedding)


def terms_by_sentence(document: dict, listed: set[int]) -> dict[int, set[int]]:
    by_sentence = defaultdict(set)
    for term_index, sentence in document["terms"]:
        if term_index in listed:
            by_sentence[sentence].add(term_index)
    return by_sentence


def cooccurrence_neighbors(documents: list[dict], listed: set[int]) -> dict[int, list[tuple[int, float]]]:
    term_sentences: Counter = Counter()
    pair_sentences: Counter = Counter()
    pair_documents: Counter = Counter()
    sentence_count = 0
    for document in documents:
        pairs_in_document = set()
        for terms_in_sentence in terms_by_sentence(document, listed).values():
            sentence_count += 1
            term_sentences.update(terms_in_sentence)
            pairs = list(combinations(sorted(terms_in_sentence), 2))
            pair_sentences.update(pairs)
            pairs_in_document.update(pairs)
        pair_documents.update(pairs_in_document)
    neighbors: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for (first, second), count in pair_sentences.items():
        if count < MIN_COOCCURRENCE_SENTENCES or pair_documents[(first, second)] < MIN_COOCCURRENCE_DOCUMENTS:
            continue
        joint = count / sentence_count
        independent = term_sentences[first] / sentence_count * term_sentences[second] / sentence_count
        npmi = float(np.log(joint / independent) / -np.log(joint))
        if npmi > 0:
            neighbors[first].append((second, npmi))
            neighbors[second].append((first, npmi))
    return {index: sorted(pairs, key=lambda pair: -pair[1])[:NEIGHBORS_PER_TERM] for index, pairs in neighbors.items()}


def contextual_embedding_neighbors(documents: list[dict], listed: list[int]) -> dict[int, list[tuple[int, float]]]:
    sentences, rows_by_term = [], defaultdict(list)
    listed_set = set(listed)
    for document in documents:
        row_by_sentence = {}
        for sentence, terms_in_sentence in terms_by_sentence(document, listed_set).items():
            if sentence not in row_by_sentence:
                row_by_sentence[sentence] = len(sentences)
                sentences.append(document["sentences"][sentence])
            for term_index in terms_in_sentence:
                rows_by_term[term_index].append(row_by_sentence[sentence])
    print(f"embedding {len(sentences)} sentences ...")
    model = SentenceTransformer(EMBEDDING_MODEL)
    vectors = model.encode(sentences, batch_size=256, normalize_embeddings=True, show_progress_bar=False)
    vectors = vectors - vectors.mean(axis=0)

    embedded = [index for index in listed if rows_by_term[index]]
    term_vectors = np.array([vectors[rows_by_term[index]].mean(axis=0) for index in embedded])
    term_vectors /= np.linalg.norm(term_vectors, axis=1, keepdims=True)
    similarity = term_vectors @ term_vectors.T
    np.fill_diagonal(similarity, -1)
    neighbors = {}
    for row, term_index in enumerate(embedded):
        best = np.argpartition(-similarity[row], NEIGHBORS_PER_TERM)[:NEIGHBORS_PER_TERM]
        best = best[np.argsort(-similarity[row][best])]
        neighbors[term_index] = [(embedded[column], float(similarity[row][column])) for column in best if similarity[row][column] > 0]
    return neighbors


def normalize(neighbors: dict[int, list[tuple[int, float]]]) -> None:
    values = [similarity for pairs in neighbors.values() for _, similarity in pairs]
    scale = float(np.percentile(values, NORMALIZING_PERCENTILE)) if values else 1.0
    for index, pairs in neighbors.items():
        neighbors[index] = [(other, min(1.0, similarity / scale)) for other, similarity in pairs]


def pack(pairs: list[tuple[int, float]]) -> list[list]:
    return [[other for other, _ in pairs], [round(similarity, 2) for _, similarity in pairs]]


def print_examples(terms, cooccurrence, embedding) -> None:
    index_by_key = {term["key"]: index for index, term in enumerate(terms)}
    for key in ["uncertainty visualization", "gpu", "llm", "topology", "mpi", "volume rendering", "morse"]:
        if key not in index_by_key:
            continue
        index = index_by_key[key]
        show = lambda pairs: ", ".join(f"{terms[other]['display']} {similarity:.2f}" for other, similarity in pairs[:8])
        print(f"\n{terms[index]['display']}\n  co-occurrence: {show(cooccurrence.get(index, []))}\n  embedding:     {show(embedding.get(index, []))}")


if __name__ == "__main__":
    main()
