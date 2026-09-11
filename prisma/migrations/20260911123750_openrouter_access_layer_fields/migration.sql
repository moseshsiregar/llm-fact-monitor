-- AlterTable
ALTER TABLE "Citation" ADD COLUMN "rawUrl" TEXT;
ALTER TABLE "Citation" ADD COLUMN "resolvedUrl" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExperimentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "experimentId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'TARGETED_RETRIEVAL',
    "dataOrigin" TEXT NOT NULL DEFAULT 'MOCK',
    "modelSnapshot" TEXT,
    "returnedModel" TEXT,
    "upstreamProvider" TEXT,
    "surface" TEXT NOT NULL DEFAULT 'MOCK_SIMULATION',
    "accessLayer" TEXT NOT NULL DEFAULT 'NONE',
    "searchMechanism" TEXT NOT NULL DEFAULT 'NONE',
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
INSERT INTO "new_ExperimentRun" ("answerText", "batchId", "completedAt", "dataOrigin", "errorCategory", "errorMessage", "experimentId", "id", "inputTokens", "mode", "modelSnapshot", "outputTokens", "promptId", "providerApi", "providerCost", "providerId", "providerRequestId", "rawResponse", "repetitionIndex", "retryCount", "searchRequestCount", "startedAt", "status", "surface", "totalTokens", "webSearchEnabled") SELECT "answerText", "batchId", "completedAt", "dataOrigin", "errorCategory", "errorMessage", "experimentId", "id", "inputTokens", "mode", "modelSnapshot", "outputTokens", "promptId", "providerApi", "providerCost", "providerId", "providerRequestId", "rawResponse", "repetitionIndex", "retryCount", "searchRequestCount", "startedAt", "status", "surface", "totalTokens", "webSearchEnabled" FROM "ExperimentRun";
DROP TABLE "ExperimentRun";
ALTER TABLE "new_ExperimentRun" RENAME TO "ExperimentRun";
CREATE INDEX "ExperimentRun_providerId_idx" ON "ExperimentRun"("providerId");
CREATE INDEX "ExperimentRun_promptId_idx" ON "ExperimentRun"("promptId");
CREATE INDEX "ExperimentRun_experimentId_idx" ON "ExperimentRun"("experimentId");
CREATE INDEX "ExperimentRun_batchId_idx" ON "ExperimentRun"("batchId");
CREATE INDEX "ExperimentRun_mode_idx" ON "ExperimentRun"("mode");
CREATE INDEX "ExperimentRun_dataOrigin_idx" ON "ExperimentRun"("dataOrigin");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
