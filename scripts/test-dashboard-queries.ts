import "dotenv/config";
import { getDashboardMatrix, getDashboardSummary } from "../src/lib/dashboard/getDashboardData";
import type { DashboardDataOrigin } from "../src/lib/dashboard/getDashboardData";
import { prisma } from "../src/lib/prisma";
import type { ExperimentMode } from "@prisma/client";

/**
 * Permanent regression test for the dashboard's Prisma queries
 * (`getDashboardMatrix` / `getDashboardSummary`).
 *
 * This exists specifically to catch the class of bug found after Phase 5:
 * a `where` filter on a to-one relation (e.g. `FactDetection.experimentRun`,
 * `Citation.experimentRun`) written as a bare object instead of using the
 * `is` relation predicate compiles fine under TypeScript but THROWS at
 * runtime (`PrismaClientValidationError: Unknown argument ...`). A
 * production build alone does not catch this - only actually executing the
 * query against the database does. Run via `npm run test:dashboard`.
 *
 * Also asserts the Phase 5 Part A contract: REAL and MOCK observations
 * never mix by default, and ALL == REAL + MOCK for run counts, for both
 * research modes.
 */

const MODES: ExperimentMode[] = ["TARGETED_RETRIEVAL", "OPEN_ENDED_DISCOVERY"];
const ORIGINS: DashboardDataOrigin[] = ["REAL", "MOCK", "ALL"];

async function main() {
  const runCounts: Record<string, number> = {};
  const cellCounts: Record<string, number> = {};

  for (const mode of MODES) {
    for (const dataOrigin of ORIGINS) {
      const filters = { mode, dataOrigin };

      // The actual regression check: these two calls must not throw. If the
      // `experimentRun`/relation filters ever regress to the bare-object
      // shorthand, Prisma will throw here at runtime even though `tsc`
      // and `next build` both pass cleanly.
      const matrix = await getDashboardMatrix(filters);
      const summary = await getDashboardSummary(matrix, filters);

      let cellCount = 0;
      for (const factId of Object.keys(matrix.cells)) {
        cellCount += Object.keys(matrix.cells[factId]).length;
      }

      runCounts[`${mode}::${dataOrigin}`] = summary.totalExperimentRuns;
      cellCounts[`${mode}::${dataOrigin}`] = cellCount;

      console.log(
        `mode=${mode} dataOrigin=${dataOrigin}: cells=${cellCount} totalRuns=${summary.totalExperimentRuns}`
      );
    }
  }

  let failed = false;

  for (const mode of MODES) {
    const realRuns = runCounts[`${mode}::REAL`];
    const mockRuns = runCounts[`${mode}::MOCK`];
    const allRuns = runCounts[`${mode}::ALL`];

    if (realRuns + mockRuns !== allRuns) {
      console.error(
        `FAIL: ${mode} run counts don't add up: REAL(${realRuns}) + MOCK(${mockRuns}) ` +
          `!== ALL(${allRuns})`
      );
      failed = true;
    }

    const realCells = cellCounts[`${mode}::REAL`];
    const mockCells = cellCounts[`${mode}::MOCK`];
    const allCells = cellCounts[`${mode}::ALL`];

    if (realCells + mockCells !== allCells) {
      console.error(
        `FAIL: ${mode} cell counts don't add up: REAL(${realCells}) + MOCK(${mockCells}) ` +
          `!== ALL(${allCells}) - REAL/MOCK may not be disjoint`
      );
      failed = true;
    }
  }

  if (failed) {
    console.error("\nFAIL: dashboard filter regression test did not pass.");
    process.exitCode = 1;
  } else {
    console.log(
      "\nPASS: dashboard queries executed without a Prisma runtime error, and ALL = REAL + MOCK " +
        "(disjoint) for both research modes."
    );
  }
}

main()
  .catch((err) => {
    console.error("FAIL: dashboard query threw at runtime:\n", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
