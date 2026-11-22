import { scenarioRegistry } from "@core/Scenarios/ScenarioRegistry";
import { SemanticWordCloudGlobalContext } from "./SemanticWordCloudGlobalContext";
import { semanticWordCloudPanelMappingFunction } from "./semanticWordCloudPanelMappingFunction";

scenarioRegistry.register({
  name: "SemanticWordCloud",
  description: "Word cloud of IEEE VIS 2026 and SC26, BM25-weighted against general English, semantic layout",
  createGlobalContext: () => new SemanticWordCloudGlobalContext(),
  panelMapping: semanticWordCloudPanelMappingFunction,
  defaultConfigPath: "ScenarioConfigs/SemanticWordCloud.json",
});
