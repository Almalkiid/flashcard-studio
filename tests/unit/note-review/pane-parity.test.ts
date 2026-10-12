import { PANE_CHANGES } from "./helpers/pane-changes";
import {
    goldenName,
    paneActiveFileExpansion,
    paneBoundary,
    paneDst,
    paneGroups,
    paneInteractions,
    paneUserFlow,
} from "./helpers/pane-scenarios";
import { expectParity } from "./helpers/parity";

jest.mock("obsidian", () => jest.requireActual<object>("./helpers/obsidian-dom-mock.cjs"));
jest.mock("src/ui/obsidian-ui-components/item-views/review-queue.css", () => ({}));
jest.mock("src/ui/obsidian-ui-components/modals/confirm-modal.css", () => ({}));

const TZ = "UTC";

test("pane-groups.json", () => {
    expectParity(goldenName("pane-groups", TZ), paneGroups(TZ), PANE_CHANGES.groups);
});
test("pane-boundary.json", () => {
    expectParity(goldenName("pane-boundary", TZ), paneBoundary(TZ), PANE_CHANGES.boundary);
});
test("pane-dst.json", () => {
    expectParity(goldenName("pane-dst", TZ), paneDst(TZ), PANE_CHANGES.dst);
});
test("pane-interactions.json", () => {
    expectParity("pane-interactions", paneInteractions(), PANE_CHANGES.interactions);
});
test("pane-active-file-expansion.json", () => {
    expectParity("pane-active-file-expansion", paneActiveFileExpansion(), PANE_CHANGES.active);
});
test("pane-user-flow.json", () => {
    expectParity("pane-user-flow", paneUserFlow(), PANE_CHANGES.userFlow);
});
