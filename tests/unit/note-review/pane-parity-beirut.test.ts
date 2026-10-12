/**
 * @jest-environment ./tests/unit/helpers/zone-environment.cjs
 * @jest-environment-options {"tz": "Asia/Beirut"}
 */
import { PANE_CHANGES } from "./helpers/pane-changes";
import { goldenName, paneBoundary, paneDst, paneGroups } from "./helpers/pane-scenarios";
import { expectParity } from "./helpers/parity";

jest.mock("obsidian", () => jest.requireActual<object>("./helpers/obsidian-dom-mock.cjs"));
jest.mock("src/ui/obsidian-ui-components/item-views/review-queue.css", () => ({}));
jest.mock("src/ui/obsidian-ui-components/modals/confirm-modal.css", () => ({}));

const TZ = "Asia/Beirut";

test(`pane-groups in ${TZ}`, () => {
    expectParity(goldenName("pane-groups", TZ), paneGroups(TZ), PANE_CHANGES.groups);
});
test(`pane-boundary in ${TZ}`, () => {
    expectParity(goldenName("pane-boundary", TZ), paneBoundary(TZ), PANE_CHANGES.boundary);
});
test(`pane-dst in ${TZ}`, () => {
    expectParity(goldenName("pane-dst", TZ), paneDst(TZ), PANE_CHANGES.dst);
});
