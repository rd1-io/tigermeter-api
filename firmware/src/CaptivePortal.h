// Simple captive portal + OTA uploader for TigerMeter
// Starts an AP with a unique name (e.g. "tigermeter-A1B2") and hosts a small HTTP UI.

#pragma once

#include <Arduino.h>

void startCaptivePortal();
void captivePortalLoop();
void webLog(const char *format, ...);  // Printf-style logging to web /logs page
const String& getApSsid();  // Get unique AP SSID (available after startCaptivePortal)







