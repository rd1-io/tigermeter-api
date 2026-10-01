-- Display delivery tracking and uptime telemetry for the admin device test page
ALTER TABLE "Device" ADD COLUMN "uptimeSeconds" INTEGER;
ALTER TABLE "Device" ADD COLUMN "displayUpdatedAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "deliveredDisplayHash" TEXT;
ALTER TABLE "Device" ADD COLUMN "displayDeliveredAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "reportedDisplayHash" TEXT;
