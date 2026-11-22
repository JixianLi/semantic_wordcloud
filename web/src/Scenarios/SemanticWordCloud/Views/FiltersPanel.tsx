import { useState } from "react";
import { observer } from "mobx-react-lite";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { Panel } from "@core/Panels/Panel";
import { useScenario } from "@core/ScenarioManager/ScenarioManager";
import { CONFERENCE_LABELS, type CorpusDocument, SOURCE_LABELS, SOURCES, trackKey } from "../CorpusData";
import type { Scope } from "../TermScoring";
import type { SemanticWordCloudGlobalContext } from "../SemanticWordCloudGlobalContext";

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
    { value: "vis", label: "VIS" },
    { value: "sc", label: "SC" },
    { value: "combined", label: "Combined" },
];

function countBy<Key>(documents: CorpusDocument[], keyOf: (document: CorpusDocument) => Key): Map<Key, number> {
    const counts = new Map<Key, number>();
    documents.forEach(document => counts.set(keyOf(document), (counts.get(keyOf(document)) ?? 0) + 1));
    return counts;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <Typography variant="overline" sx={{ display: "block", color: "text.secondary", mt: 1.5, lineHeight: 2 }}>{children}</Typography>;
}

export default observer(function FiltersPanel() {
    const context = useScenario().globalContext as SemanticWordCloudGlobalContext;
    const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
    const toggleExpanded = (source: string) => setExpandedSources(previous => {
        const next = new Set(previous);
        next.has(source) ? next.delete(source) : next.add(source);
        return next;
    });
    const scopeDocuments = context.scopeDocuments;
    const countBySource = countBy(scopeDocuments, document => document.source);
    const countByTrack = countBy(scopeDocuments, trackKey);
    const tracksBySource = new Map<string, string[]>();
    [...countByTrack.keys()].sort().forEach(key => {
        const source = key.split("|")[1];
        tracksBySource.set(source, [...(tracksBySource.get(source) ?? []), key]);
    });

    return (
        <Panel panelName="Filters">
            <Box sx={{ px: 1.5, pb: 1.5 }}>
                <SectionTitle>Scope</SectionTitle>
                <ToggleButtonGroup
                    size="small" exclusive fullWidth value={context.scope}
                    onChange={(_, value: Scope | null) => value && context.setScope(value)}
                >
                    {SCOPE_OPTIONS.map(option => <ToggleButton key={option.value} value={option.value}>{option.label}</ToggleButton>)}
                </ToggleButtonGroup>
                {context.scope === "combined" && (
                    <Box sx={{ mt: 1 }}>
                        <FormControlLabel
                            control={<Switch size="small" checked={context.balanceVenues} onChange={(_, checked) => context.setBalanceVenues(checked)} />}
                            label="Balance venues"
                        />
                        <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                            {context.balanceVenues
                                ? "On: VIS and SC each contribute the same total weight, so a term's size reflects how prominent it is within each venue."
                                : "Off: scores are summed as is, so the venue with more text (SC has about twice as much) weighs more."}
                        </Typography>
                    </Box>
                )}

                <SectionTitle>Sources</SectionTitle>
                {SOURCES.filter(source => countBySource.has(source)).map(source => (
                    <Box key={source}>
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <FormControlLabel
                                control={<Checkbox size="small" checked={context.selectedSources.has(source)} onChange={() => context.toggleSource(source)} />}
                                label={`${SOURCE_LABELS[source]} (${countBySource.get(source)})`}
                            />
                            {context.selectedSources.has(source) && (tracksBySource.get(source)?.length ?? 0) > 1 && (
                                <Button size="small" onClick={() => toggleExpanded(source)} sx={{ minWidth: 0, textTransform: "none" }}>
                                    {expandedSources.has(source) ? "Hide tracks" : "Tracks"}
                                </Button>
                            )}
                        </Box>
                        {context.selectedSources.has(source) && expandedSources.has(source) && (tracksBySource.get(source)?.length ?? 0) > 1 && (
                            <Box sx={{ pl: 3, display: "flex", flexDirection: "column" }}>
                                {tracksBySource.get(source)!.map(key => {
                                    const [conference, , track] = key.split("|");
                                    const prefix = context.scope === "combined" ? `${CONFERENCE_LABELS[conference as "vis" | "sc"]} · ` : "";
                                    return (
                                        <FormControlLabel
                                            key={key}
                                            control={<Checkbox size="small" checked={!context.excludedTracks.has(key)} onChange={() => context.toggleTrack(key)} />}
                                            label={<Typography variant="body2">{`${prefix}${track} (${countByTrack.get(key)})`}</Typography>}
                                            sx={{ my: -0.5 }}
                                        />
                                    );
                                })}
                            </Box>
                        )}
                    </Box>
                ))}

                <SectionTitle>Terms</SectionTitle>
                <Typography variant="body2">{`Show ${context.termLimit} terms`}</Typography>
                <Slider
                    size="small" min={30} max={400} step={10} value={context.termLimit}
                    onChange={(_, value) => context.setTermLimit(value as number)}
                />
                <FormControlLabel
                    control={<Switch size="small" checked={context.includePhrases} onChange={(_, checked) => context.setIncludePhrases(checked)} />}
                    label="Include phrases (n-grams)"
                />
                <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1 }}>
                    {`${context.selectedDocuments.length} documents. Size: BM25 weight against general English (${context.corpus?.bm25.background ?? "…"}).`}
                </Typography>

                <SectionTitle>Layout</SectionTitle>
                <Typography variant="body2">Related means</Typography>
                <Slider
                    size="small" min={0} max={1} step={0.05} value={context.embeddingWeight}
                    onChange={(_, value) => context.setEmbeddingWeight(value as number)}
                />
                <Box sx={{ display: "flex", justifyContent: "space-between", mt: -1 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>Same sentences</Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>Similar contexts</Typography>
                </Box>
                <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mb: 1 }}>
                    Left: terms that co-occur in sentences. Right: terms used in similar contexts (sentence embeddings).
                    After a big change, re-layout from scratch.
                </Typography>
                <Typography variant="body2">{`Links per term: ${context.linksPerTerm}`}</Typography>
                <Slider
                    size="small" min={0} max={8} step={1} value={context.linksPerTerm}
                    onChange={(_, value) => context.setLinksPerTerm(value as number)}
                />
                <Typography variant="body2">{`Link strength: ${context.linkStrength.toFixed(2)}`}</Typography>
                <Slider
                    size="small" min={0} max={1.5} step={0.05} value={context.linkStrength}
                    onChange={(_, value) => context.setLinkStrength(value as number)}
                />
                <FormControlLabel
                    control={<Switch size="small" checked={context.showAllLinks} onChange={(_, checked) => context.setShowAllLinks(checked)} />}
                    label="Show all links"
                />
                <Box sx={{ mt: 1 }}>
                    <Button size="small" variant="outlined" onClick={() => context.relayout()}>Re-layout from scratch</Button>
                </Box>
            </Box>
        </Panel>
    );
});
