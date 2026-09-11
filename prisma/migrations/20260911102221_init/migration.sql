-- CreateTable
CREATE TABLE "Politician" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "party" TEXT,
    "office" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "politicianId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "canonicalFactText" TEXT NOT NULL,
    "description" TEXT,
    "originalSourceUrl" TEXT NOT NULL,
    "originalSourceDomain" TEXT NOT NULL,
    "originalSourceCategory" TEXT NOT NULL,
    "identifyingKeywords" TEXT,
    "publishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PRE_PUBLICATION',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Fact_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "Politician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchPrompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "politicianId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "promptType" TEXT NOT NULL DEFAULT 'GENERAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchPrompt_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "Politician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LLMProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "searchEnabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExperimentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "batchId" TEXT,
    "repetitionIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "answerText" TEXT,
    "rawResponse" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "ExperimentRun_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LLMProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperimentRun_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "ResearchPrompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentRunId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Citation_experimentRunId_fkey" FOREIGN KEY ("experimentRunId") REFERENCES "ExperimentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FactDetection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentRunId" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "citationId" TEXT,
    "status" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0,
    "matchingExcerpt" TEXT,
    "detectionMethod" TEXT NOT NULL DEFAULT 'KEYWORD_MATCH',
    "sourceRelationship" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FactDetection_experimentRunId_fkey" FOREIGN KEY ("experimentRunId") REFERENCES "ExperimentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactDetection_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactDetection_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Fact_politicianId_idx" ON "Fact"("politicianId");

-- CreateIndex
CREATE INDEX "ResearchPrompt_politicianId_idx" ON "ResearchPrompt"("politicianId");

-- CreateIndex
CREATE UNIQUE INDEX "LLMProvider_providerKey_key" ON "LLMProvider"("providerKey");

-- CreateIndex
CREATE INDEX "ExperimentRun_providerId_idx" ON "ExperimentRun"("providerId");

-- CreateIndex
CREATE INDEX "ExperimentRun_promptId_idx" ON "ExperimentRun"("promptId");

-- CreateIndex
CREATE INDEX "ExperimentRun_batchId_idx" ON "ExperimentRun"("batchId");

-- CreateIndex
CREATE INDEX "Citation_experimentRunId_idx" ON "Citation"("experimentRunId");

-- CreateIndex
CREATE INDEX "FactDetection_factId_idx" ON "FactDetection"("factId");

-- CreateIndex
CREATE INDEX "FactDetection_experimentRunId_idx" ON "FactDetection"("experimentRunId");

-- CreateIndex
CREATE INDEX "FactDetection_citationId_idx" ON "FactDetection"("citationId");
