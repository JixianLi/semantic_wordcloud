import { makeAutoObservable, observable, reaction, runInAction } from "mobx";
import type { GlobalContext } from "@core/Types/GlobalContext";
import {
    type Conference, type Corpus, type CorpusDocument, loadCorpus, loadNeighbors, type Source, SOURCES, trackKey,
} from "./CorpusData";
import { type Scope, scopeConferences, type ScoredTerm, scoreTerms } from "./TermScoring";
import { blendedSimilarity, indexSimilarities, type SimilarityLink, type TermSimilarities, visibleLinks } from "./Similarity";
import { type MeasuredWord, measureWords, type PlacedWord } from "./Graph/WordLayout";
import type { LayoutRequest } from "./Graph/LayoutWorker";

// Expected global_data keys (all optional):
//   corpus_url, neighbors_url: string     where corpus.json / neighbors.json are served
//   scope: "vis" | "sc" | "combined"
//   sources: Source[]                     selected sources
//   excluded_tracks: string[]             "conference|source|track" keys left out
//   balance_venues: boolean               combined scope only
//   term_limit: number
//   include_phrases: boolean
//   embedding_weight: number              0 = co-occurrence only, 1 = contextual embedding only
//   links_per_term: number
//   link_strength: number
//   show_all_links: boolean

const FONT_FAMILY = '"Inter Variable", Inter, system-ui, sans-serif';
const FONT_WEIGHT = 500;
const MINIMUM_LINK_SIMILARITY = 0.15;
// Debounce for layout requests: slider drags settle before the worker starts.
const LAYOUT_DELAY_MS = 80;

export interface TermDetail {
    termIndex: number;
    key: string;
    display: string;
    idf: number;
    backgroundDf: number;
    corpusDf: number;
    score: number;
    scoreByConference: Record<Conference, number>;
    scoreBySource: Partial<Record<Source, number>>;
    neighbors: { termIndex: number; display: string; similarity: number; visible: boolean }[];
    documents: { document: CorpusDocument; weight: number }[];
    documentCount: number;
}

export class SemanticWordCloudGlobalContext implements GlobalContext {
    corpusUrl = "data/corpus.json";
    neighborsUrl = "data/neighbors.json";
    corpus: Corpus | null = null;
    similarities: TermSimilarities | null = null;
    loadError: string | null = null;

    scope: Scope = "combined";
    selectedSources = new Set<Source>(["accepted_entries", "keynote", "website"]);
    excludedTracks = new Set<string>();
    balanceVenues = true;
    termLimit = 150;
    includePhrases = true;
    embeddingWeight = 0.5;
    linksPerTerm = 3;
    linkStrength = 0.6;
    showAllLinks = false;
    aspectRatio = 1.6;

    selectedTermKey: string | null = null;
    hoveredTermKey: string | null = null;
    placedWords: PlacedWord[] = [];
    layoutPending = false;

    private worker: Worker | null = null;
    private latestRequestId = 0;
    // relayout() bumps the counter (observable, so the layout reaction re-runs) and sets startFresh (not observable),
    // which that next run reads once to ignore the previous positions.
    private relayoutCounter = 0;
    private startFresh = false;

    constructor() {
        makeAutoObservable<this, "worker" | "latestRequestId" | "startFresh">(this, {
            corpus: observable.ref,
            similarities: observable.ref,
            placedWords: observable.ref,
            worker: false,
            latestRequestId: false,
            startFresh: false,
        });
    }

    initialize(globalData: any): void {
        const data = globalData ?? {};
        this.corpusUrl = data.corpus_url ?? this.corpusUrl;
        this.neighborsUrl = data.neighbors_url ?? this.neighborsUrl;
        this.scope = data.scope ?? this.scope;
        if (Array.isArray(data.sources)) {
            this.selectedSources = new Set(data.sources);
        }
        if (Array.isArray(data.excluded_tracks)) {
            this.excludedTracks = new Set(data.excluded_tracks);
        }
        this.balanceVenues = data.balance_venues ?? this.balanceVenues;
        this.termLimit = data.term_limit ?? this.termLimit;
        this.includePhrases = data.include_phrases ?? this.includePhrases;
        this.embeddingWeight = data.embedding_weight ?? this.embeddingWeight;
        this.linksPerTerm = data.links_per_term ?? this.linksPerTerm;
        this.linkStrength = data.link_strength ?? this.linkStrength;
        this.showAllLinks = data.show_all_links ?? this.showAllLinks;
    }

    async asyncInitialize(): Promise<void> {
        try {
            const [corpus, neighbors] = await Promise.all([loadCorpus(this.corpusUrl), loadNeighbors(this.neighborsUrl)]);
            await document.fonts?.ready;
            runInAction(() => {
                this.corpus = corpus;
                this.similarities = indexSimilarities(neighbors);
            });
            this.startLayoutWorker();
        } catch (error) {
            runInAction(() => {
                this.loadError = String(error);
            });
        }
    }

    toObject(): any {
        return {
            corpus_url: this.corpusUrl,
            neighbors_url: this.neighborsUrl,
            scope: this.scope,
            sources: SOURCES.filter(source => this.selectedSources.has(source)),
            excluded_tracks: [...this.excludedTracks].sort(),
            balance_venues: this.balanceVenues,
            term_limit: this.termLimit,
            include_phrases: this.includePhrases,
            embedding_weight: this.embeddingWeight,
            links_per_term: this.linksPerTerm,
            link_strength: this.linkStrength,
            show_all_links: this.showAllLinks,
        };
    }

    // The worker lives as long as the page: GlobalContext has no teardown hook, so switching scenarios leaves it idle.
    private startLayoutWorker(): void {
        this.worker = new Worker(new URL("./Graph/LayoutWorker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (event: MessageEvent<{ requestId: number; placed: PlacedWord[] }>) => {
            if (event.data.requestId !== this.latestRequestId) {
                return;
            }
            runInAction(() => {
                this.placedWords = event.data.placed;
                this.layoutPending = false;
            });
        };
        reaction(
            () => ({ words: this.measuredWords, links: this.layoutLinks, aspectRatio: this.aspectRatio,
                     linkStrength: this.linkStrength, relayout: this.relayoutCounter }),
            ({ words, links, aspectRatio, linkStrength }) => {
                const fresh = this.startFresh;
                this.startFresh = false;
                const previousPositions = fresh ? {} : Object.fromEntries(this.placedWords.map(word => [word.key, { x: word.x, y: word.y }]));
                const request: LayoutRequest = {
                    requestId: ++this.latestRequestId,
                    words,
                    links,
                    options: { aspectRatio, linkStrength, previousPositions },
                };
                runInAction(() => {
                    this.layoutPending = true;
                });
                this.worker?.postMessage(request);
            },
            { delay: LAYOUT_DELAY_MS, fireImmediately: true },
        );
    }

    setScope(scope: Scope): void {
        this.scope = scope;
    }

    toggleSource(source: Source): void {
        const next = new Set(this.selectedSources);
        next.has(source) ? next.delete(source) : next.add(source);
        this.selectedSources = next;
    }

    toggleTrack(key: string): void {
        const next = new Set(this.excludedTracks);
        next.has(key) ? next.delete(key) : next.add(key);
        this.excludedTracks = next;
    }

    setBalanceVenues(balance: boolean): void {
        this.balanceVenues = balance;
    }

    setTermLimit(limit: number): void {
        this.termLimit = limit;
    }

    setIncludePhrases(include: boolean): void {
        this.includePhrases = include;
    }

    setEmbeddingWeight(weight: number): void {
        this.embeddingWeight = weight;
    }

    setLinksPerTerm(count: number): void {
        this.linksPerTerm = count;
    }

    setLinkStrength(strength: number): void {
        this.linkStrength = strength;
    }

    setShowAllLinks(show: boolean): void {
        this.showAllLinks = show;
    }

    // Start from scratch instead of the previous positions.
    relayout(): void {
        this.startFresh = true;
        this.relayoutCounter += 1;
    }

    setAspectRatio(aspectRatio: number): void {
        if (Number.isFinite(aspectRatio) && aspectRatio > 0 && Math.abs(aspectRatio - this.aspectRatio) > 0.05) {
            this.aspectRatio = aspectRatio;
        }
    }

    selectTerm(key: string | null): void {
        this.selectedTermKey = key === this.selectedTermKey ? null : key;
    }

    hoverTerm(key: string | null): void {
        this.hoveredTermKey = key;
    }

    // Documents of the scope, before source and track filters: what the filter counts are computed over.
    get scopeDocuments(): CorpusDocument[] {
        if (!this.corpus) {
            return [];
        }
        const conferences = new Set(scopeConferences(this.scope));
        return this.corpus.documents.filter(document => conferences.has(document.conference));
    }

    get selectedDocuments(): CorpusDocument[] {
        return this.scopeDocuments.filter(document =>
            this.selectedSources.has(document.source) && !this.excludedTracks.has(trackKey(document)));
    }

    get isVenueBalanced(): boolean {
        return this.scope === "combined" && this.balanceVenues;
    }

    get scoredTerms(): ScoredTerm[] {
        if (!this.corpus) {
            return [];
        }
        return scoreTerms(this.corpus, this.selectedDocuments, {
            balanceVenues: this.isVenueBalanced,
            includePhrases: this.includePhrases,
            termLimit: this.termLimit,
        });
    }

    get scoredTermByKey(): Map<string, ScoredTerm> {
        const corpus = this.corpus;
        return new Map(corpus ? this.scoredTerms.map(scored => [corpus.terms[scored.termIndex].key, scored]) : []);
    }

    get measuredWords(): MeasuredWord[] {
        const corpus = this.corpus;
        if (!corpus) {
            return [];
        }
        return measureWords(this.scoredTerms.map(scored => ({
            key: corpus.terms[scored.termIndex].key,
            text: corpus.terms[scored.termIndex].display,
            weight: scored.score,
        })), { maxFontSize: 56, minFontSize: 10, fontFamily: FONT_FAMILY, fontWeight: FONT_WEIGHT });
    }

    get layoutLinks(): SimilarityLink[] {
        if (!this.similarities) {
            return [];
        }
        return visibleLinks(this.scoredTerms.map(scored => scored.termIndex), this.similarities, this.embeddingWeight,
                            this.linksPerTerm, MINIMUM_LINK_SIMILARITY);
    }

    // Links between placed words, by key, for drawing.
    get drawnLinks(): { source: string; target: string; similarity: number }[] {
        const words = this.measuredWords;
        const placedKeys = new Set(this.placedWords.map(word => word.key));
        return this.layoutLinks
            .map(link => ({ source: words[link.source]?.key, target: words[link.target]?.key, similarity: link.similarity }))
            .filter(link => placedKeys.has(link.source) && placedKeys.has(link.target));
    }

    get selectedTermDetail(): TermDetail | null {
        const corpus = this.corpus;
        const key = this.selectedTermKey;
        if (!corpus || !key) {
            return null;
        }
        const termIndex = corpus.terms.findIndex(term => term.key === key);
        if (termIndex < 0) {
            return null;
        }
        const term = corpus.terms[termIndex];
        const scored = this.scoredTermByKey.get(key);
        const scoreBySource: Partial<Record<Source, number>> = {};
        const documents: { document: CorpusDocument; weight: number }[] = [];
        for (const document of this.selectedDocuments) {
            const position = document.term_indices.indexOf(termIndex);
            if (position >= 0) {
                const weight = document.weights[position];
                scoreBySource[document.source] = (scoreBySource[document.source] ?? 0) + weight;
                documents.push({ document, weight });
            }
        }
        documents.sort((first, second) => second.weight - first.weight);
        const visibleKeys = this.scoredTermByKey;
        const neighbors = [...(this.similarities?.byTerm.get(termIndex) ?? new Map()).entries()]
            .map(([other, pair]) => ({
                termIndex: other,
                display: corpus.terms[other].display,
                similarity: blendedSimilarity(pair, this.embeddingWeight),
                visible: visibleKeys.has(corpus.terms[other].key),
            }))
            .sort((first, second) => second.similarity - first.similarity)
            .slice(0, 12);
        return {
            termIndex,
            key,
            display: term.display,
            idf: term.idf,
            backgroundDf: term.background_df,
            corpusDf: term.df,
            score: scored?.score ?? 0,
            scoreByConference: scored?.scoreByConference ?? { vis: 0, sc: 0 },
            scoreBySource,
            neighbors,
            documents: documents.slice(0, 25),
            documentCount: documents.length,
        };
    }

    get fontFamily(): string {
        return FONT_FAMILY;
    }

    get fontWeight(): number {
        return FONT_WEIGHT;
    }
}
