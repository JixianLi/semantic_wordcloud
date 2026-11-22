import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { Panel } from "@core/Panels/Panel";
import { useScenario } from "@core/ScenarioManager/ScenarioManager";
import type { SemanticWordCloudGlobalContext } from "../SemanticWordCloudGlobalContext";
import { layoutBounds } from "../Graph/WordLayout";

const VIEW_PADDING = 12;

export default observer(function CloudPanel() {
    const context = useScenario().globalContext as SemanticWordCloudGlobalContext;
    const theme = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);

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
    const bounds = layoutBounds(words);
    const viewBox = [bounds.x - VIEW_PADDING, bounds.y - VIEW_PADDING, bounds.width + 2 * VIEW_PADDING, bounds.height + 2 * VIEW_PADDING].join(" ");

    return (
        <Panel panelName="Cloud">
            <Box ref={containerRef} sx={{ width: "100%", height: "100%", position: "relative", minHeight: 0 }}>
                {context.loadError && <Typography color="error" sx={{ p: 2 }}>{context.loadError}</Typography>}
                {!context.corpus && !context.loadError && <Typography sx={{ p: 2, color: "text.secondary" }}>Loading corpus…</Typography>}
                {context.corpus && words.length === 0 && (
                    <Typography sx={{ p: 2, color: "text.secondary" }}>No documents selected.</Typography>
                )}
                <svg width="100%" height="100%" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
                    {words.map(word => (
                        <text
                            key={word.key}
                            x={word.x}
                            y={word.y}
                            fontSize={word.fontSize}
                            fontFamily={context.fontFamily}
                            fontWeight={context.fontWeight}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill={theme.tokens.text}
                            opacity={hoveredKey && hoveredKey !== word.key ? 0.35 : 1}
                            onMouseEnter={() => setHoveredKey(word.key)}
                            onMouseLeave={() => setHoveredKey(null)}
                            style={{ cursor: "default", transition: "opacity 120ms" }}
                        >
                            <title>{`${word.text} — score ${word.weight.toFixed(1)}`}</title>
                            {word.text}
                        </text>
                    ))}
                </svg>
            </Box>
        </Panel>
    );
});
