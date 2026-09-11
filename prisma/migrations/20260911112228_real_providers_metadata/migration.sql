-- CreateTable
CREATE TABLE "SearchQuery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentRunId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchQuery_experimentRunId_fkey" FOREIGN KEY ("experimentRunId") REFERENCES "ExperimentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Citation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentRunId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "spanKind" TEXT NOT NULL DEFAULT 'RESPONSE_LEVEL',
    "startIndex" INTEGER,
    "endIndex" INTEGER,
    "citedText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Citation_experimentRunId_fkey" FOREIGN KEY ("experimentRunId") REFERENCES "ExperimentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Citation" ("createdAt", "domain", "experimentRunId", "id", "title", "url") SELECT "createdAt", "domain", "experimentRunId", "id", "title", "url" FROM "Citation";
DROP TABLE "Citation";
ALTER TABLE "new_Citation" RENAME TO "Citation";
CREATE INDEX "Citation_experimentRunId_idx" ON "Citation"("experimentRunId");
CREATE TABLE "new_Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "politicianId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL,
    "repetitions" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dataOrigin" TEXT NOT NULL DEFAULT 'MOCK',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Experiment_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "Politician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Experiment" ("createdAt", "id", "mode", "name", "politicianId", "repetitions", "status", "subjectName", "updatedAt") SELECT "createdAt", "id", "mode", "name", "politicianId", "repetitions", "status", "subjectName", "updatedAt" FROM "Experiment";
DROP TABLE "Experiment";
ALTER TABLE "new_Experiment" RENAME TO "Experiment";
CREATE INDEX "Experiment_politicianId_idx" ON "Experiment"("politicianId");
CREATE TABLE "new_ExperimentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "experimentId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'TARGETED_RETRIEVAL',
    "dataOrigin" TEXT NOT NULL DEFAULT 'MOCK',
    "modelSnapshot" TEXT,
    "surface" TEXT NOT NULL DEFAULT 'MOCK_SIMULATION',
    "webSearchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "providerApi" TEXT,
    "providerRequestId" TEXT,
    "errorCategory" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "searchRequestCount" INTEGER,
    "providerCost" REAL,
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
INSERT INTO "new_ExperimentRun" ("answerText", "batchId", "completedAt", "errorMessage", "experimentId", "id", "mode", "promptId", "providerId", "rawResponse", "repetitionIndex", "startedAt", "status") SELECT "answerText", "batchId", "completedAt", "errorMessage", "experimentId", "id", "mode", "promptId", "providerId", "rawResponse", "repetitionIndex", "startedAt", "status" FROM "ExperimentRun";
DROP TABLE "ExperimentRun";
ALTER TABLE "new_ExperimentRun" RENAME TO "ExperimentRun";
CREATE INDEX "ExperimentRun_providerId_idx" ON "ExperimentRun"("providerId");
CREATE INDEX "ExperimentRun_promptId_idx" ON "ExperimentRun"("promptId");
CREATE INDEX "ExperimentRun_experimentId_idx" ON "ExperimentRun"("experimentId");
CREATE INDEX "ExperimentRun_batchId_idx" ON "ExperimentRun"("batchId");
CREATE INDEX "ExperimentRun_mode_idx" ON "ExperimentRun"("mode");
CREATE INDEX "ExperimentRun_dataOrigin_idx" ON "ExperimentRun"("dataOrigin");
CREATE TABLE "new_LLMProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "searchEnabled" BOOLEAN NOT NULL DEFAULT true,
    "kind" TEXT NOT NULL DEFAULT 'MOCK',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_LLMProvider" ("active", "createdAt", "id", "model", "name", "providerKey", "searchEnabled") SELECT "active", "createdAt", "id", "model", "name", "providerKey", "searchEnabled" FROM "LLMProvider";
DROP TABLE "LLMProvider";
ALTER TABLE "new_LLMProvider" RENAME TO "LLMProvider";
CREATE UNIQUE INDEX "LLMProvider_providerKey_key" ON "LLMProvider"("providerKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SearchQuery_experimentRunId_idx" ON "SearchQuery"("experimentRunId");
