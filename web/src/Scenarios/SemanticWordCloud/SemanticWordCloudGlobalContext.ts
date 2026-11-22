import { makeAutoObservable, observable, runInAction } from "mobx";
import type { GlobalContext } from "@core/Types/GlobalContext";
import { type Corpus, type CorpusDocument, loadCorpus, type Source, SOURCES, trackKey } from "./CorpusData";
import { type Scope, scopeConferences, type ScoredTerm, scoreTerms } from "./TermScoring";
import { layoutWords, type PlacedWord } from "./Graph/WordLayout";

// Expected global_data keys (all optional):
//   corpus_url: string             where corpus.json is served (default "data/corpus.json")
//   scope: "vis" | "sc" | "combined"
//   sources: Source[]              selected sources
//   excluded_tracks: string[]      "conference|source|track" keys left out
//   balance_venues: boolean        combined scope only
//   term_limit: number
//   include_phrases: boolean

const FONT_FAMILY = '"Inter Variable", Inter, system-ui, sans-serif';
const FONT_WEIGHT = 500;

export class SemanticWordCloudGlobalContext implements GlobalContext {
    corpusUrl = "data/corpus.json";
    corpus: Corpus | null = null;
    loadError: string | null = null;

    scope: Scope = "combined";
    selectedSources = new Set<Source>(["accepted_entries", "keynote", "website"]);
    excludedTracks = new Set<string>();
    balanceVenues = true;
    termLimit = 150;
    includePhrases = true;
    aspectRatio = 1.6;

    // Not observable on purpose: placedWords reads it as the warm start and replaces it with the new layout, a cache
    // write inside a computed that must not trigger a re-computation.
    private previousPositions = new Map<string, { x: number; y: number }>();

    constructor() {
        makeAutoObservable<this, "previousPositions">(this, {
            corpus: observable.ref,
            previousPositions: false,
        });
    }

    initialize(globalData: any): void {
        const data = globalData ?? {};
        this.corpusUrl = data.corpus_url ?? this.corpusUrl;
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
    }

    async asyncInitialize(): Promise<void> {
        try {
            const corpus = await loadCorpus(this.corpusUrl);
            await document.fonts?.ready;
            runInAction(() => {
                this.corpus = corpus;
            });
        } catch (error) {
            runInAction(() => {
                this.loadError = String(error);
            });
        }
    }

    toObject(): any {
        return {
            corpus_url: this.corpusUrl,
            scope: this.scope,
            sources: SOURCES.filter(source => this.selectedSources.has(source)),
            excluded_tracks: [...this.excludedTracks].sort(),
            balance_venues: this.balanceVenues,
            term_limit: this.termLimit,
            include_phrases: this.includePhrases,
        };
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

    setAspectRatio(aspectRatio: number): void {
        if (Number.isFinite(aspectRatio) && aspectRatio > 0 && Math.abs(aspectRatio - this.aspectRatio) > 0.05) {
            this.aspectRatio = aspectRatio;
        }
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

    get scoredTerms(): ScoredTerm[] {
        if (!this.corpus) {
            return [];
        }
        return scoreTerms(this.corpus, this.selectedDocuments, {
            balanceVenues: this.scope === "combined" && this.balanceVenues,
            includePhrases: this.includePhrases,
            termLimit: this.termLimit,
        });
    }

    get placedWords(): PlacedWord[] {
        const corpus = this.corpus;
        if (!corpus) {
            return [];
        }
        const words = this.scoredTerms.map(scored => ({
            key: corpus.terms[scored.termIndex].key,
            text: corpus.terms[scored.termIndex].display,
            weight: scored.score,
        }));
        const placed = layoutWords(words, {
            maxFontSize: 56,
            minFontSize: 10,
            fontFamily: FONT_FAMILY,
            fontWeight: FONT_WEIGHT,
            aspectRatio: this.aspectRatio,
            previousPositions: this.previousPositions,
        });
        this.previousPositions = new Map(placed.map(word => [word.key, { x: word.x, y: word.y }]));
        return placed;
    }

    get fontFamily(): string {
        return FONT_FAMILY;
    }

    get fontWeight(): number {
        return FONT_WEIGHT;
    }
}
