/**
 * @jest-environment ./tests/unit/helpers/zone-environment.cjs
 * @jest-environment-options {"tz": "Asia/Beirut"}
 */
import { testSkippedMidnight } from "./skipped-midnight-cases";

// Beirut skips midnight on 29 March 2026: the clocks go from 23:59 to 01:00
testSkippedMidnight("Asia/Beirut", "2026-03-26", "2026-03-29");
