/**
 * @jest-environment ./tests/unit/helpers/zone-environment.cjs
 * @jest-environment-options {"tz": "America/Santiago"}
 */
import { testSkippedMidnight } from "./skipped-midnight-cases";

// Santiago skips midnight on 6 September 2026, in the other half of the year
testSkippedMidnight("America/Santiago", "2026-09-03", "2026-09-06");
