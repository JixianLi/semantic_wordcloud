"""Word tokens of a text with spaCy, and how they become term keys.

A WordToken is one word that may count as a term: not punctuation, a number, a URL, or a spaCy stopword, and of a
kept part of speech. It keeps its position in the spaCy doc and its sentence index, so later stages can test
adjacency (phrases) and co-occurrence (sentence windows). Which lemma it counts as, whether its named-entity tag drops
it, and whether it is on the stoplist are decided over the whole corpus (see build_terms).
"""

import re
from dataclasses import dataclass
from pathlib import Path

import spacy
from spacy.language import Language
from spacy.tokens import Doc

# Verbs are left out: the ones that dominate abstracts are generic research verbs ("evaluate", "demonstrate",
# "enable") that 1961 Brown barely contains, so they would get near-maximal IDF.
KEPT_PARTS_OF_SPEECH = {"NOUN", "PROPN", "ADJ", "X"}
# Entity types that name people and places rather than content. Dropped per occurrence only for lemmas mostly used
# as such an entity (build_terms.MIN_ENTITY_SHARE), because spaCy's small model also tags "AI" or "Slurm" as people.
NAME_ENTITY_LABELS = {"PERSON", "GPE", "NORP"}
# Organizations stay ("NVIDIA" is content at SC), except affiliations.
AFFILIATION = re.compile(r"\b(universit|institut|college|laborator|school|academy)", re.IGNORECASE)
# spaCy lemmatizes "data" to "datum" and "analytics" to "analytic"; people say "data" and "analytics".
LEMMA_OVERRIDES = {"datum": "data", "analytic": "analytics"}
ACRONYM_PLURAL = re.compile(r"^[A-Z][A-Z0-9]+s$")
HAS_LETTER = re.compile(r"[a-z]")
WORD_LIKE = re.compile(r"^[a-z0-9][a-z0-9+.#-]*$")


@dataclass
class WordToken:
    text: str
    lemma: str
    part_of_speech: str
    position: int
    sentence: int
    in_name_entity: bool
    # " " or "-" when the previous WordToken directly precedes it in the same sentence (a hyphen counts as no gap,
    # "multi-scale"); "" when something was dropped in between, so no phrase can span the two.
    separator_from_previous: str = ""


def load_language(with_parser_and_entities: bool = True) -> Language:
    if with_parser_and_entities:
        return spacy.load("en_core_web_sm")
    return spacy.load("en_core_web_sm", disable=["parser", "ner"])


def read_term_list(path: Path) -> tuple[set[str], set[str]]:
    """(terms, "+"-prefixed exception phrases) from a one-entry-per-line file with # comments."""
    terms, exceptions = set(), set()
    for line in path.read_text().splitlines():
        entry = line.strip().lower()
        if not entry or entry.startswith("#"):
            continue
        (exceptions if entry.startswith("+") else terms).add(entry.lstrip("+").strip())
    return terms, exceptions


def word_tokens(doc: Doc) -> list[WordToken]:
    in_name_entity, in_affiliation = set(), set()
    for entity in doc.ents:
        if entity.label_ in NAME_ENTITY_LABELS:
            in_name_entity.update(range(entity.start, entity.end))
        elif entity.label_ == "ORG" and AFFILIATION.search(entity.text):
            in_affiliation.update(range(entity.start, entity.end))
    sentence_index_by_token = {}
    if doc.has_annotation("SENT_START"):
        for index_sentence, sentence in enumerate(doc.sents):
            for token in sentence:
                sentence_index_by_token[token.i] = index_sentence
    tokens = []
    for token in doc:
        lemma = token.lemma_.lower().strip()
        if token.i in in_affiliation or not is_word(token, lemma):
            continue
        word = WordToken(token.text, lemma, token.pos_, token.i, sentence_index_by_token.get(token.i, 0),
                         token.i in in_name_entity)
        if tokens and tokens[-1].sentence == word.sentence:
            gap = word.position - tokens[-1].position
            if gap == 1:
                word.separator_from_previous = " "
            elif gap == 2 and doc[word.position - 1].text == "-":
                word.separator_from_previous = "-"
        tokens.append(word)
    return tokens


def is_word(token, lemma: str) -> bool:
    if token.is_stop or token.is_punct or token.like_num or token.like_url or token.like_email:
        return False
    if token.pos_ not in KEPT_PARTS_OF_SPEECH or len(lemma) < 2:
        return False
    return bool(HAS_LETTER.search(lemma)) and bool(WORD_LIKE.match(lemma))


def term_key(token: WordToken, lemma_by_lowercase_text: dict[str, str]) -> str:
    """The lemma a token counts as. Title-case words in titles are tagged PROPN and so never lemmatized; they take the
    lemma the same word gets elsewhere in the corpus (lemma_by_lowercase_text, learned from non-PROPN tokens)."""
    lowercase = token.text.lower()
    if ACRONYM_PLURAL.match(token.text):
        key = lowercase[:-1]
    elif token.part_of_speech == "PROPN" and lowercase in lemma_by_lowercase_text:
        key = lemma_by_lowercase_text[lowercase]
    else:
        key = token.lemma
    return LEMMA_OVERRIDES.get(key, key)


def display_form(token: WordToken, key: str) -> str:
    if ACRONYM_PLURAL.match(token.text):
        return token.text[:-1]
    if token.text.lower() == key:
        return token.text
    if token.text[:1].isupper() and token.text[1:].islower():
        return key.capitalize()
    return key
