import CloudPanel from "./Views/CloudPanel";

export function semanticWordCloudPanelMappingFunction(viewName: string): React.ReactNode {
  switch (viewName) {
    case "Cloud": return <CloudPanel />;
    default: throw new Error(`Unknown view: ${viewName}`);
  }
}
