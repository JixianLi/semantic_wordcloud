import { observer } from "mobx-react-lite";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { Panel } from "@core/Panels/Panel";
import { useScenario } from "@core/ScenarioManager/ScenarioManager";
import { CONFERENCE_LABELS, SOURCE_LABELS, SOURCES } from "../CorpusData";
import type { SemanticWordCloudGlobalContext } from "../SemanticWordCloudGlobalContext";

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <Typography variant="overline" sx={{ display: "block", color: "text.secondary", mt: 1.5, lineHeight: 2 }}>{children}</Typography>;
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>{label}</Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
        </Box>
    );
}

export default observer(function TermDetailPanel() {
    const context = useScenario().globalContext as SemanticWordCloudGlobalContext;
    const detail = context.selectedTermDetail;

    return (
        <Panel panelName="TermDetail">
            <Box sx={{ px: 1.5, pb: 1.5 }}>
                {!detail && (
                    <Typography variant="body2" sx={{ color: "text.secondary", pt: 1 }}>
                        Click a word to see where its weight comes from, its nearest terms, and the entries that use it.
                    </Typography>
                )}
                {detail && (
                    <>
                        <Typography variant="h6" sx={{ pt: 0.5 }}>{detail.display}</Typography>

                        {detail.zScore !== undefined && (
                            <>
                                <SectionTitle>VIS vs SC</SectionTitle>
                                <Row label="Log-odds z-score" value={`${detail.zScore >= 0 ? "+" : ""}${detail.zScore.toFixed(2)} (${detail.zScore >= 0 ? "VIS" : "SC"})`} />
                                <Row label="Occurrences in VIS" value={String(detail.scoreByConference.vis)} />
                                <Row label="Occurrences in SC" value={String(detail.scoreByConference.sc)} />
                            </>
                        )}
                        <SectionTitle>Score in the current selection</SectionTitle>
                        {detail.zScore === undefined && <Row label="Total" value={detail.score.toFixed(1)} />}
                        {context.scope === "combined" && detail.zScore === undefined && (["vis", "sc"] as const).map(conference => (
                            <Row
                                key={conference}
                                label={`${CONFERENCE_LABELS[conference]}${context.isVenueBalanced ? " (balanced)" : ""}`}
                                value={detail.scoreByConference[conference].toFixed(1)}
                            />
                        ))}
                        {SOURCES.filter(source => detail.scoreBySource[source]).map(source => (
                            <Row key={source} label={SOURCE_LABELS[source]} value={(detail.scoreBySource[source] ?? 0).toFixed(1)} />
                        ))}

                        <SectionTitle>Why it is weighted</SectionTitle>
                        <Row label="Brown samples containing it" value={`${detail.backgroundDf} of 500`} />
                        <Row label="Background IDF" value={detail.idf.toFixed(2)} />
                        <Row label="Entries using it (whole corpus)" value={String(detail.corpusDf)} />

                        <SectionTitle>Nearest terms</SectionTitle>
                        {detail.neighbors.length === 0 && <Typography variant="body2" sx={{ color: "text.secondary" }}>None above the threshold.</Typography>}
                        {detail.neighbors.map(neighbor => (
                            <Row
                                key={neighbor.termIndex}
                                label={neighbor.visible ? `${neighbor.display}` : `${neighbor.display} (not shown)`}
                                value={neighbor.similarity.toFixed(2)}
                            />
                        ))}

                        <SectionTitle>{`Entries (${detail.documentCount} in the selection)`}</SectionTitle>
                        {detail.documents.map(({ document, weight }) => (
                            <Box key={document.id} sx={{ mb: 0.75 }}>
                                <Link href={document.url} target="_blank" rel="noopener noreferrer" variant="body2" underline="hover">
                                    {document.title}
                                </Link>
                                <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                                    {`${CONFERENCE_LABELS[document.conference]} · ${document.track} · weight ${weight.toFixed(2)}`}
                                </Typography>
                            </Box>
                        ))}
                        {detail.documentCount > detail.documents.length && (
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                {`Showing the ${detail.documents.length} highest-weighted.`}
                            </Typography>
                        )}
                    </>
                )}
            </Box>
        </Panel>
    );
});
