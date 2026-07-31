-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mac" TEXT NOT NULL,
    "tenantId" TEXT,
    "externalUserId" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_claim',
    "hmacKey" TEXT,
    "lastSeen" DATETIME,
    "battery" INTEGER,
    "rssi" INTEGER,
    "ip" TEXT,
    "firmwareVersion" TEXT,
    "displayHash" TEXT,
    "displayVersion" INTEGER NOT NULL DEFAULT 0,
    "displayFramesJson" TEXT,
    "currentSecretHash" TEXT,
    "currentSecretExpiresAt" DATETIME,
    "previousSecretHash" TEXT,
    "previousSecretExpiresAt" DATETIME,
    "pendingFactoryReset" BOOLEAN NOT NULL DEFAULT false,
    "autoUpdate" BOOLEAN NOT NULL DEFAULT true,
    "demoMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DeviceClaim" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "firmwareVersion" TEXT,
    "ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "userId" TEXT,
    "secretIssued" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceClaim_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PendingDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mac" TEXT NOT NULL,
    "firmwareVersion" TEXT,
    "ip" TEXT,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending'
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_mac_key" ON "Device"("mac");

-- CreateIndex
CREATE INDEX "Device_tenantId_idx" ON "Device"("tenantId");

-- CreateIndex
CREATE INDEX "DeviceClaim_status_idx" ON "DeviceClaim"("status");

-- CreateIndex
CREATE INDEX "DeviceClaim_mac_idx" ON "DeviceClaim"("mac");

-- CreateIndex
CREATE UNIQUE INDEX "PendingDevice_mac_key" ON "PendingDevice"("mac");
