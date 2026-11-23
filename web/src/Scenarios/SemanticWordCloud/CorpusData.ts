// Shape of public/data/corpus.json, written by the pipeline (pipeline/src/semantic_wordcloud/build_terms.py).

export type Conference = "vis" | "sc";
export type Source = "accepted_entries" | "fulltext" | "keynote" | "website";

export const CONFERENCES: Conference[] = ["vis", "sc"];
export const SOURCES: Source[] = ["accepted_entries", "fulltext", "keynote", "website"];
export const CONFERENCE_LABELS: Record<Conference, string> = { vis: "VIS", sc: "SC" };
export const SOURCE_LABELS: Record<Source, string> = {
    accepted_entries: "Accepted entries",
    fulltext: "Full text",
    keynote: "Keynotes & invited talks",
    website: "Website",
};

export interface CorpusTerm {
    key: string;
    display: string;
    tokens: number;
    idf: number;
    background_df: number;
    df: number;
}

export interface CorpusDocument {
    id: string;
    conference: Conference;
    source: Source;
    track: string;
    title: string;
    url: string;
    // Term occurrences in the document; their sum over a venue's selected documents is that venue's total for the
    // "Balance venues" weighting.
    term_count: number;
    // The document's top BM25 weights as parallel arrays: weights[i] is the weight of terms[term_indices[i]].
    term_indices: number[];
    weights: number[];
    // Raw occurrence counts of the same terms (parallel to term_indices), for the VIS-vs-SC log-odds comparison.
    counts: number[];
}

export interface Corpus {
    bm25: { k1: number; b: number; background: string };
    terms: CorpusTerm[];
    documents: CorpusDocument[];
}

export async function loadCorpus(url: string): Promise<Corpus> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load ${url}: ${response.status}`);
    }
    return response.json();
}

export function trackKey(document: Pick<CorpusDocument, "conference" | "source" | "track">): string {
    return `${document.conference}|${document.source}|${document.track}`;
}

// Shape of public/data/neighbors.json (pipeline/src/semantic_wordcloud/build_semantics.py): for each listed term,
// its nearest terms by each measure as [neighbor term indices, similarities 0..1], best first.
export interface NeighborLists {
    model: string;
    terms: number[];
    cooccurrence: [number[], number[]][];
    embedding: [number[], number[]][];
}

export async function loadNeighbors(url: string): Promise<NeighborLists> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load ${url}: ${response.status}`);
    }
    return response.json();
}
