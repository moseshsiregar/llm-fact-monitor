-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "politicianId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "repetitions" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Experiment_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "Politician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExperimentFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentId" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    CONSTRAINT "ExperimentFact_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperimentFact_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExperimentPrompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    CONSTRAINT "ExperimentPrompt_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperimentPrompt_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "ResearchPrompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExperimentProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    CONSTRAINT "ExperimentProvider_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperimentProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LLMProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExperimentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "experimentId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'TARGETED_RETRIEVAL',
    "batchId" TEXT,
    "repetitionIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "answerText" TEXT,
    "rawResponse" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "ExperimentRun_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LLMProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperimentRun_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "ResearchPrompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperimentRun_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ExperimentRun" ("answerText", "batchId", "completedAt", "errorMessage", "id", "promptId", "providerId", "rawResponse", "repetitionIndex", "startedAt", "status") SELECT "answerText", "batchId", "completedAt", "errorMessage", "id", "promptId", "providerId", "rawResponse", "repetitionIndex", "startedAt", "status" FROM "ExperimentRun";
DROP TABLE "ExperimentRun";
ALTER TABLE "new_ExperimentRun" RENAME TO "ExperimentRun";
CREATE INDEX "ExperimentRun_providerId_idx" ON "ExperimentRun"("providerId");
CREATE INDEX "ExperimentRun_promptId_idx" ON "ExperimentRun"("promptId");
CREATE INDEX "ExperimentRun_experimentId_idx" ON "ExperimentRun"("experimentId");
CREATE INDEX "ExperimentRun_batchId_idx" ON "ExperimentRun"("batchId");
CREATE INDEX "ExperimentRun_mode_idx" ON "ExperimentRun"("mode");
CREATE TABLE "new_FactDetection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentRunId" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "citationId" TEXT,
    "status" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0,
    "matchingExcerpt" TEXT,
    "detectionMethod" TEXT NOT NULL DEFAULT 'KEYWORD_MATCH',
    "sourceRelationship" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "citationAttribution" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FactDetection_experimentRunId_fkey" FOREIGN KEY ("experimentRunId") REFERENCES "ExperimentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactDetection_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactDetection_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FactDetection" ("citationId", "confidence", "detectedAt", "detectionMethod", "experimentRunId", "factId", "id", "matchingExcerpt", "sourceRelationship", "status") SELECT "citationId", "confidence", "detectedAt", "detectionMethod", "experimentRunId", "factId", "id", "matchingExcerpt", "sourceRelationship", "status" FROM "FactDetection";
DROP TABLE "FactDetection";
ALTER TABLE "new_FactDetection" RENAME TO "FactDetection";
CREATE INDEX "FactDetection_factId_idx" ON "FactDetection"("factId");
CREATE INDEX "FactDetection_experimentRunId_idx" ON "FactDetection"("experimentRunId");
CREATE INDEX "FactDetection_citationId_idx" ON "FactDetection"("citationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Experiment_politicianId_idx" ON "Experiment"("politicianId");

-- CreateIndex
CREATE INDEX "ExperimentFact_factId_idx" ON "ExperimentFact"("factId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentFact_experimentId_factId_key" ON "ExperimentFact"("experimentId", "factId");

-- CreateIndex
CREATE INDEX "ExperimentPrompt_promptId_idx" ON "ExperimentPrompt"("promptId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentPrompt_experimentId_promptId_key" ON "ExperimentPrompt"("experimentId", "promptId");

-- CreateIndex
CREATE INDEX "ExperimentProvider_providerId_idx" ON "ExperimentProvider"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentProvider_experimentId_providerId_key" ON "ExperimentProvider"("experimentId", "providerId");
