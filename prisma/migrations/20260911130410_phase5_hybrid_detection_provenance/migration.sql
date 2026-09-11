-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FactDetection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentRunId" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "citationId" TEXT,
    "status" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0,
    "matchingExcerpt" TEXT,
    "detectionMethod" TEXT NOT NULL DEFAULT 'KEYWORD_MATCH',
    "detectorVersion" TEXT NOT NULL DEFAULT 'v1-adjacent-bigram',
    "deterministicScore" REAL,
    "semanticVerifierModel" TEXT,
    "semanticVerifierVersion" TEXT,
    "justification" TEXT,
    "sourceRelationship" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "citationAttribution" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FactDetection_experimentRunId_fkey" FOREIGN KEY ("experimentRunId") REFERENCES "ExperimentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactDetection_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactDetection_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FactDetection" ("citationAttribution", "citationId", "confidence", "detectedAt", "detectionMethod", "experimentRunId", "factId", "id", "matchingExcerpt", "sourceRelationship", "status") SELECT "citationAttribution", "citationId", "confidence", "detectedAt", "detectionMethod", "experimentRunId", "factId", "id", "matchingExcerpt", "sourceRelationship", "status" FROM "FactDetection";
DROP TABLE "FactDetection";
ALTER TABLE "new_FactDetection" RENAME TO "FactDetection";
CREATE INDEX "FactDetection_factId_idx" ON "FactDetection"("factId");
CREATE INDEX "FactDetection_experimentRunId_idx" ON "FactDetection"("experimentRunId");
CREATE INDEX "FactDetection_citationId_idx" ON "FactDetection"("citationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
