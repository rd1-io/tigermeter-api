/*
  Warnings:

  - You are about to drop the column `userId` on the `DeviceClaim` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeviceClaim" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "firmwareVersion" TEXT,
    "ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "secretIssued" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceClaim_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DeviceClaim" ("code", "createdAt", "deviceId", "expiresAt", "firmwareVersion", "ip", "mac", "secretIssued", "status") SELECT "code", "createdAt", "deviceId", "expiresAt", "firmwareVersion", "ip", "mac", "secretIssued", "status" FROM "DeviceClaim";
DROP TABLE "DeviceClaim";
ALTER TABLE "new_DeviceClaim" RENAME TO "DeviceClaim";
CREATE INDEX "DeviceClaim_status_idx" ON "DeviceClaim"("status");
CREATE INDEX "DeviceClaim_mac_idx" ON "DeviceClaim"("mac");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
