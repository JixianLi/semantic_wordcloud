import CloudPanel from "./Views/CloudPanel";
import FiltersPanel from "./Views/FiltersPanel";
import TermDetailPanel from "./Views/TermDetailPanel";

export function semanticWordCloudPanelMappingFunction(viewName: string): React.ReactNode {
    switch (viewName) {
        case "Cloud": return <CloudPanel />;
        case "Filters": return <FiltersPanel />;
        case "TermDetail": return <TermDetailPanel />;
        default: throw new Error(`Unknown view: ${viewName}`);
    }
}
