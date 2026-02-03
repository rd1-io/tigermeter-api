// Simple captive portal + OTA uploader for TigerMeter
// Starts an AP called "tigermeter" and hosts a small HTTP UI.

#pragma once

void startCaptivePortal();
void captivePortalLoop();
void webLog(const char *format, ...);  // Printf-style logging to web /logs page







