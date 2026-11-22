import CloudPanel from "./Views/CloudPanel";
import FiltersPanel from "./Views/FiltersPanel";

export function semanticWordCloudPanelMappingFunction(viewName: string): React.ReactNode {
    switch (viewName) {
        case "Cloud": return <CloudPanel />;
        case "Filters": return <FiltersPanel />;
        default: throw new Error(`Unknown view: ${viewName}`);
    }
}
