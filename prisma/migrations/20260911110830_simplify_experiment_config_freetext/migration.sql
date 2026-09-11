-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "politicianId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL,
    "repetitions" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Experiment_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "Politician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Experiment" ("createdAt", "id", "mode", "name", "politicianId", "repetitions", "status", "updatedAt") SELECT "createdAt", "id", "mode", "name", "politicianId", "repetitions", "status", "updatedAt" FROM "Experiment";
DROP TABLE "Experiment";
ALTER TABLE "new_Experiment" RENAME TO "Experiment";
CREATE INDEX "Experiment_politicianId_idx" ON "Experiment"("politicianId");
CREATE TABLE "new_Fact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "politicianId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "canonicalFactText" TEXT NOT NULL,
    "description" TEXT,
    "originalSourceUrl" TEXT,
    "originalSourceDomain" TEXT,
    "originalSourceCategory" TEXT,
    "identifyingKeywords" TEXT,
    "publishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PRE_PUBLICATION',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Fact_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "Politician" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Fact" ("active", "canonicalFactText", "createdAt", "description", "id", "identifyingKeywords", "label", "originalSourceCategory", "originalSourceDomain", "originalSourceUrl", "politicianId", "publishedAt", "status") SELECT "active", "canonicalFactText", "createdAt", "description", "id", "identifyingKeywords", "label", "originalSourceCategory", "originalSourceDomain", "originalSourceUrl", "politicianId", "publishedAt", "status" FROM "Fact";
DROP TABLE "Fact";
ALTER TABLE "new_Fact" RENAME TO "Fact";
CREATE INDEX "Fact_politicianId_idx" ON "Fact"("politicianId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
