import { observer } from "mobx-react-lite";
import { Panel } from "@core/Panels/Panel";

export default observer(function CloudPanel() {
  return <Panel panelName="Cloud">The word cloud arrives in Phase 2.</Panel>;
});
