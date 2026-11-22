import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { Panel } from "@core/Panels/Panel";
import { useScenario } from "@core/ScenarioManager/ScenarioManager";
import type { SemanticWordCloudGlobalContext } from "../SemanticWordCloudGlobalContext";
import { layoutBounds } from "../Graph/WordLayout";
import { venueColorScale, venuePoles } from "../VenueColors";

const VIEW_PADDING = 12;

export default observer(function CloudPanel() {
    const context = useScenario().globalContext as SemanticWordCloudGlobalContext;
    const theme = useTheme();
    const tokens = theme.tokens;
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (height > 0) {
                context.setAspectRatio(width / height);
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [context]);

    const words = context.placedWords;
    const positionByKey = new Map(words.map(word => [word.key, word]));
    const bounds = layoutBounds(words);
    const viewBox = [bounds.x - VIEW_PADDING, bounds.y - VIEW_PADDING, bounds.width + 2 * VIEW_PADDING, bounds.height + 2 * VIEW_PADDING].join(" ");

    const colorByVenue = context.scope === "combined";
    const venueColor = venueColorScale(tokens.mode, tokens.text);
    const scoredByKey = context.scoredTermByKey;
    const colorOf = (key: string) => {
        const scored = scoredByKey.get(key);
        if (!colorByVenue || !scored || scored.score <= 0) {
            return tokens.text;
        }
        return venueColor(scored.scoreByConference.sc / scored.score);
    };

    const focusKey = context.hoveredTermKey ?? context.selectedTermKey;
    const links = context.drawnLinks;
    const focusLinks = focusKey ? links.filter(link => link.source === focusKey || link.target === focusKey) : [];
    const focusNeighbors = new Set(focusLinks.flatMap(link => [link.source, link.target]));
    const shownLinks = context.showAllLinks ? links : focusLinks;

    return (
        <Panel panelName="Cloud">
            <Box ref={containerRef} sx={{ width: "100%", height: "100%", position: "relative", minHeight: 0 }}>
                {context.loadError && <Typography color="error" sx={{ p: 2 }}>{context.loadError}</Typography>}
                {!context.corpus && !context.loadError && <Typography sx={{ p: 2, color: "text.secondary" }}>Loading corpus…</Typography>}
                {context.corpus && context.scoredTerms.length === 0 && (
                    <Typography sx={{ p: 2, color: "text.secondary" }}>No documents selected.</Typography>
                )}
                <svg
                    width="100%" height="100%" viewBox={viewBox} preserveAspectRatio="xMidYMid meet"
                    style={{ display: "block" }}
                    onClick={() => context.selectTerm(null)}
                >
                    <g>
                        {shownLinks.map(link => {
                            const source = positionByKey.get(link.source);
                            const target = positionByKey.get(link.target);
                            if (!source || !target) {
                                return null;
                            }
                            return (
                                <line
                                    key={`${link.source}|${link.target}`}
                                    x1={source.x} y1={source.y} x2={target.x} y2={target.y}
                                    stroke={tokens.textMuted} strokeWidth={0.5 + 1.5 * link.similarity}
                                    strokeOpacity={focusKey ? 0.7 : 0.25}
                                />
                            );
                        })}
                    </g>
                    {words.map(word => {
                        const dimmed = focusKey !== null && word.key !== focusKey && !focusNeighbors.has(word.key);
                        const selected = word.key === context.selectedTermKey;
                        return (
                            <text
                                key={word.key}
                                x={word.x}
                                y={word.y}
                                fontSize={word.fontSize}
                                fontFamily={context.fontFamily}
                                fontWeight={selected ? 700 : context.fontWeight}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill={colorOf(word.key)}
                                opacity={dimmed ? 0.25 : 1}
                                textDecoration={selected ? "underline" : undefined}
                                onMouseEnter={() => context.hoverTerm(word.key)}
                                onMouseLeave={() => context.hoverTerm(null)}
                                onClick={event => {
                                    event.stopPropagation();
                                    context.selectTerm(word.key);
                                }}
                                style={{ cursor: "pointer", transition: "opacity 120ms, x 400ms, y 400ms" }}
                            >
                                {word.text}
                            </text>
                        );
                    })}
                </svg>
                {colorByVenue && words.length > 0 && <VenueLegend />}
                {context.layoutPending && (
                    <Typography variant="caption" sx={{ position: "absolute", top: 4, left: 8, color: "text.secondary" }}>
                        Laying out…
                    </Typography>
                )}
            </Box>
        </Panel>
    );
});

const VenueLegend = observer(function VenueLegend() {
    const tokens = useTheme().tokens;
    const poles = venuePoles(tokens.mode);
    const scale = venueColorScale(tokens.mode, tokens.text);
    const stops = [0, 0.25, 0.5, 0.75, 1].map(share => `${scale(share)} ${share * 100}%`).join(", ");
    return (
        <Box sx={{ position: "absolute", left: 12, bottom: 10, width: 220 }}>
            <Box sx={{ height: 8, borderRadius: "4px", background: `linear-gradient(to right, ${stops})` }} />
            <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    <Box component="span" sx={{ display: "inline-block", width: 8, height: 8, borderRadius: "2px", bgcolor: poles.vis, mr: 0.5 }} />
                    VIS
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>shared</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    SC
                    <Box component="span" sx={{ display: "inline-block", width: 8, height: 8, borderRadius: "2px", bgcolor: poles.sc, ml: 0.5 }} />
                </Typography>
            </Box>
        </Box>
    );
});
