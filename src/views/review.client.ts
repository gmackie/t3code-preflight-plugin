import { toolData } from "./bridge.ts";
import type { ExecuteData } from "./render.ts";
import { errorText, mountReview, startView } from "./shared.client.ts";

const bridge = startView("preflight-release-review");
const review = mountReview(bridge, document.getElementById("app")!);

bridge.onToolResult = (result) => {
  if (result.isError) review.fail(errorText(result, "Release review failed to load."));
  else review.show(toolData<ExecuteData>(result));
};
void bridge.connect();
