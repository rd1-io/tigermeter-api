// Include common types first (needed for Arduino preprocessor)
#include "types.h"

// Global firmware version, passed via build flags (-D FW_VERSION=X)
#ifndef FW_VERSION
#define FW_VERSION 0  // Default if not set
#endif
extern const int CURRENT_FIRMWARE_VERSION = FW_VERSION;

// ============== API MODE ==============
#ifdef API_MODE
#include <WiFiManager.h>
#include "Display.h"
#include <stdlib.h>
#include <time.h>
#include <WiFi.h>
#include "CaptivePortal.h"
#include "utility/LedColorsAndNoises.h"
#include "utility/ApiClient.h"
#include "utility/FirmwareUpdate.h"
// BinanceLogo.h and CurrencySymbols.h removed — no predefined logos in v5
#include "DEV_Config.h"

// Display geometry (after rotation: 384x168)
const int VISUAL_WIDTH = DISPLAY_WIDTH;    // 384
const int VISUAL_HEIGHT = DISPLAY_HEIGHT;  // 168

// API configuration
#ifndef API_BASE_URL
#define API_BASE_URL "https://api-tiger.rd1.io/api/v5"
#endif

// Timing
const unsigned long POLL_INTERVAL_MS = 3000;
const unsigned long HEARTBEAT_INTERVAL_MS = 30000;
const unsigned long WIFI_CHECK_INTERVAL_MS = 60000;
const unsigned long OTA_CHECK_INTERVAL_MS = 3600000;
const unsigned long FIRST_OTA_CHECK_DELAY_MS = 60000; // First OTA check 60s after boot

// Global state
ApiClient apiClient(API_BASE_URL);
DeviceState currentState = STATE_UNCLAIMED;
unsigned long lastPollTime = 0;
unsigned long lastHeartbeatTime = 0;
unsigned long lastOtaCheckTime = 0;
unsigned long startTime = 0;
bool firstOtaCheckDone = false;
String currentClaimCode = "";
String lastDisplayedError = "";

// Frame display state (v5: bitmap rotation)
// Bitmaps stored as PSRAM pointers — allocated once in setup()
DisplayFrame displayFrames[MAX_DISPLAY_FRAMES];
uint8_t displayFrameCount = 0;
uint8_t currentFrameIndex = 0;
uint32_t displayRefreshInterval = 60;
String displayHash = "";
unsigned long frameStartTime = 0;      // When current frame started showing
bool oneShotFired[MAX_DISPLAY_FRAMES]; // Track beep/flash one-shot per download cycle
bool hasDisplayContent = false;        // True when frames are loaded

// Rainbow task state
bool isRainbow = false;
TaskHandle_t rainbowTaskHandle = NULL;
void startRainbow();
void stopRainbow();
void rainbowTask(void *pvParameters);

// Server connection tracking
int consecutiveHeartbeatFailures = 0;
bool isReconnecting = false;
bool wifiDisconnectedDisplayed = false;
TaskHandle_t amberPulseTaskHandle = NULL;

// Battery reading
const float BATTERY_MULTIPLIER = 2.19f;

int getBatteryPercent() {
    int raw = analogRead(35);
    float voltage = (raw / 4095.0f) * 3.3f * BATTERY_MULTIPLIER;
    int percent = (int)((voltage - 3.0f) / (4.1f - 3.0f) * 100.0f);
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    return percent;
}

// Draw battery icon (white on black background)
void drawBatteryIcon(int x, int y) {
    display.drawRoundRect(x, y, 24, 12, 2, false);
    display.fillRect(x + 24, y + 3, 3, 6, false);
    display.fillRoundRect(x + 2, y + 2, 2, 8, 1, false);
}

// Function prototypes
void initializeDisplay();
void displayClaimCode(const char *code);
void displayFrameFullScreen(uint8_t frameIndex);
void displayWaitingForContent();
void displayWifiMessage();
void displayError(const char *msg);
void displaySystemScreen(const char* tag, const char* line1, const char* line2);
void handleApiStateMachine();
void applyFrameLedBeep(uint8_t frameIndex);
void led_Purple();
void led_Green();
void led_Red();
void led_Yellow();
void led_Blue();
void led_Off();
void setLedBrightness(const String& brightness);
void playBuzzerPositive();
void playBuzzerNegative();
void initializePins();

// Demo mode functions
void renderDemoHeader();
void renderDemoUptime();
void runDemoLoop();
void demoLedTask(void *pvParameters);

// IP address display
void displayIPAddress();

// Reconnecting state functions
void displayReconnecting();
void amberPulseTask(void *pvParameters);
void startAmberPulse();
void stopAmberPulse();

// Demo mode state
bool localDemoMode = false;

// ============== HELPER: generic system screen ==============
// Draws a system screen: tag in left black bar, two text lines on right
void displaySystemScreen(const char* tag, const char* line1, const char* line2) {
    display.clear();
    // Left bar: tag text centered in 135x168 black rectangle
    display.fillRect(0, 0, 135, 168, true);
    display.setFontSize(32);
    display.setTextColor(false);  // White on black
    int tagW = display.getTextWidth(tag);
    int tagH = display.getFontHeight();
    display.drawText((135 - tagW) / 2, (168 - tagH) / 2, tag);

    // Right area
    if (line1 && strlen(line1) > 0) {
        display.setFontSize(20);
        display.setTextColor(true);  // Black on white
        display.drawText(150, 60, line1);
    }
    if (line2 && strlen(line2) > 0) {
        display.setFontSize(16);
        display.setTextColor(true);
        display.drawText(150, 90, line2);
    }
}

void displayWaitingForContent() {
    displaySystemScreen("...", NULL, "Waiting for");
    display.setFontSize(16);
    display.setTextColor(true);
    display.drawText(150, 78, "content");
}

void displayWifiMessage() {
    displaySystemScreen("WiFi", getApSsid().c_str(), "192.168.4.1");
}

void displayClaimCode(const char *code) {
    displaySystemScreen("CODE", NULL, NULL);
    display.setFontSize(32);
    display.setTextColor(true);
    int codeW = display.getTextWidth(code);
    display.drawText(135 + (DISPLAY_WIDTH - 135 - codeW) / 2, (168 - display.getFontHeight()) / 2, code);
}

void displayIPAddress() {
    String ip = WiFi.localIP().toString();
    displaySystemScreen("IP", ip.c_str(), NULL);
}

void displayError(const char *msg) {
    displaySystemScreen("ERR", msg, NULL);
}

void displayReconnecting() {
    displaySystemScreen("ERR", "Reconnecting...", NULL);
}

// ============== FRAME DISPLAY ==============
// Draw a single frame full-screen (384x168)
void displayFrameFullScreen(uint8_t frameIndex) {
    if (frameIndex >= displayFrameCount) return;
    if (displayFrames[frameIndex].durationSec == 0) return; // Invalid/skipped frame

    display.clear();
    display.drawBitmap(0, 0, displayFrames[frameIndex].bitmap, DISPLAY_WIDTH, DISPLAY_HEIGHT, false, false);
    display.refresh();

    Serial.printf("[Main] Drawing frame %d/%d (duration=%us)\n",
                  frameIndex + 1, displayFrameCount, displayFrames[frameIndex].durationSec);
}

// Apply LED color, beep, flash for a given frame (one-shot per download cycle)
void applyFrameLedBeep(uint8_t frameIndex) {
    if (frameIndex >= displayFrameCount) return;

    DisplayFrame& f = displayFrames[frameIndex];
    String color = String(f.ledColor);
    String brightness = String(f.ledBrightness);

    // Always set LED color + brightness for this frame
    stopRainbow();
    setLedBrightness(brightness);
    if (brightness == "off") {
        led_Off();
    } else if (color == "rainbow") {
        startRainbow();
    } else if (color == "green") led_Green();
    else if (color == "red") led_Red();
    else if (color == "blue") led_Blue();
    else if (color == "yellow") led_Yellow();
    else if (color == "purple") led_Purple();
    else if (color == "cyan" || color == "magenta" || color == "white") led_Green(); // Fallback
    else led_Off();

    // One-shot beep/flash (fire only first time after download)
    if (!oneShotFired[frameIndex]) {
        oneShotFired[frameIndex] = true;

        if (f.beep) {
            playBuzzerPositive();
        }
        if (f.flashCount > 0) {
            for (int i = 0; i < f.flashCount; i++) {
                pulseColorByName(color, 800);
                if (i < f.flashCount - 1) delay(100);
            }
            // Restore LED
            setLedBrightness(brightness);
            if (brightness == "off") {
                led_Off();
            } else if (color == "rainbow") startRainbow();
            else if (color == "green") led_Green();
            else if (color == "red") led_Red();
            else if (color == "blue") led_Blue();
            else if (color == "yellow") led_Yellow();
            else if (color == "purple") led_Purple();
            else led_Off();
        }
    }
}

void setup()
{
    Serial.begin(115200);
    delay(100);

    Serial.println("[Main] Starting TigerMeter v5 (API MODE)...");

    startTime = millis();

    // Initialize LEDC for LED PWM control
    initializePins();

    // Immediately set LED to dim yellow (10% brightness)
    setLedPWM(229, 247, 255);

    // Initialize e-paper display
    Serial.println("[Main] Initializing e-paper display...");
    initializeDisplay();
    Serial.println("[Main] Display initialized");

    // Allocate PSRAM buffers for display frames
    Serial.println("[Main] Allocating PSRAM frame buffers...");
    for (int i = 0; i < MAX_DISPLAY_FRAMES; i++) {
        displayFrames[i].bitmap = (uint8_t*)ps_malloc(DISPLAY_FRAME_SIZE);
        if (!displayFrames[i].bitmap) {
            Serial.printf("[Main] ERROR: PSRAM alloc failed for frame %d\n", i);
        }
        displayFrames[i].durationSec = 0;
        displayFrames[i].ledColor[0] = '\0';
        displayFrames[i].ledBrightness[0] = '\0';
        displayFrames[i].beep = false;
        displayFrames[i].flashCount = 0;
    }
    Serial.printf("[Main] PSRAM free: %u bytes\n", ESP.getFreePsram());

    // Show boot screen — simple text, no Binance logo
    display.clear();
    display.setFontSize(32);
    display.setTextColor(true);
    int textW = display.getTextWidth("TigerMeter");
    display.drawText((384 - textW) / 2, (168 - display.getFontHeight()) / 2 - 10, "TigerMeter");
    display.setFontSize(16);
    const char* ver = FIRMWARE_VERSION;
    int verW = display.getTextWidth(ver);
    display.drawText((384 - verW) / 2, (168 - display.getFontHeight()) / 2 + 15, ver);
    display.refresh();
    Serial.println("[Main] Boot screen displayed");

    // Fade in yellow LED
    fadeInYellow(2000);

    // Start captive portal AP + OTA
    startCaptivePortal();

    // Check if demo mode is enabled locally
    {
        Preferences demoPrefs;
        demoPrefs.begin("tigermeter", true);
        localDemoMode = demoPrefs.getBool("demoMode", false);
        demoPrefs.end();
    }

    if (localDemoMode) {
        Serial.println("[Main] Demo mode enabled, starting demo loop...");
        playBuzzerPositive();
        xTaskCreatePinnedToCore(demoLedTask, "demoLed", 2048, NULL, 1, NULL, 1);
        runDemoLoop();
        // runDemoLoop never returns
    }

    // Show WiFi message
    displayWifiMessage();
    display.refresh();
    Serial.println("[Main] WiFi message displayed");

    // Try to connect using stored credentials
    unsigned long startAttemptTime = millis();
    const unsigned long connectionTimeout = 20000;
    while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < connectionTimeout)
    {
        captivePortalLoop();
        delay(100);
    }

    // Initialize API client
    apiClient.begin();

    // Initialize NTP time if WiFi is connected
    if (WiFi.status() == WL_CONNECTED) {
        displayIPAddress();
        delay(1000);
        Serial.println("[Main] WiFi connected, initializing NTP...");
        configTime(0, 0, "pool.ntp.org", "time.nist.gov");
        int ntpWait = 0;
        while (time(nullptr) < 1000000000 && ntpWait < 50) {
            delay(100);
            ntpWait++;
        }
        if (time(nullptr) > 1000000000) {
            Serial.println("[Main] NTP time synchronized");
        } else {
            Serial.println("[Main] NTP sync timeout, will retry later");
        }
    }

    // Check if we have stored credentials
    if (apiClient.hasCredentials()) {
        currentState = STATE_ACTIVE;
        Serial.println("[Main] Found stored credentials, entering ACTIVE state");
        led_Green();
    } else {
        currentState = STATE_UNCLAIMED;
        Serial.println("[Main] No credentials, entering UNCLAIMED state");
    }

    // Main loop
    while (1)
    {
        captivePortalLoop();
        handleApiStateMachine();
        delay(50);
    }
}

void loop()
{
    // Not used in API mode
}

void handleApiStateMachine()
{
    unsigned long now = millis();

    // Check WiFi periodically
    if (WiFi.status() != WL_CONNECTED)
    {
        if (!wifiDisconnectedDisplayed) {
            led_Yellow();
            displayWifiMessage();
            display.refresh();
            wifiDisconnectedDisplayed = true;
        }
        return;
    }
    if (wifiDisconnectedDisplayed) {
        displayIPAddress();
    }
    wifiDisconnectedDisplayed = false;

    switch (currentState)
    {
    case STATE_UNCLAIMED:
    {
        Serial.println("[Main] STATE_UNCLAIMED - issuing claim...");
        if (lastDisplayedError.isEmpty()) {
            led_Blue();
        }

        ClaimResult result = apiClient.issueClaim();

        if (result.success)
        {
            currentClaimCode = result.code;
            currentState = STATE_CLAIMING;
            lastDisplayedError = "";
            led_Blue();
            displayClaimCode(result.code.c_str());
            display.refresh();
            Serial.println("[Main] Got claim code: " + result.code);
            playBuzzerPositive();
        }
        else
        {
            Serial.println("[Main] Claim failed: " + result.errorMessage);
            if (lastDisplayedError != result.errorMessage) {
                lastDisplayedError = result.errorMessage;
                displayError(result.errorMessage.c_str());
                display.refresh();
            }
            led_Yellow();
            delay(5000);
        }
        break;
    }

    case STATE_CLAIMING:
        currentState = STATE_WAITING_ATTACH;
        lastPollTime = now;
        break;

    case STATE_WAITING_ATTACH:
    {
        if (now - lastPollTime >= POLL_INTERVAL_MS)
        {
            lastPollTime = now;
            led_Blue();

            PollResult result = apiClient.pollClaim();

            if (result.claimed)
            {
                currentState = STATE_ACTIVE;
                Serial.println("[Main] Claimed! Device ID: " + result.deviceId);
                led_Green();
                playBuzzerPositive();

                displaySystemScreen("OK", "Connected!", NULL);
                display.refresh();
                delay(2000);

                lastHeartbeatTime = 0;
                hasDisplayContent = false;
                displayFrameCount = 0;
                for (int i = 0; i < MAX_DISPLAY_FRAMES; i++) oneShotFired[i] = false;
            }
            else if (result.pending)
            {
                led_Blue();
            }
            else if (result.expired || result.notFound)
            {
                Serial.println("[Main] Claim expired/consumed, restarting...");
                currentClaimCode = "";
                currentState = STATE_UNCLAIMED;
                lastDisplayedError = "Claim expired";
                led_Yellow();
            }
        }
        break;
    }

    case STATE_ACTIVE:
    {
        // Send heartbeats
        unsigned long heartbeatIntervalMs = (displayRefreshInterval > 0)
            ? (displayRefreshInterval * 1000UL)
            : HEARTBEAT_INTERVAL_MS;
        if (now - lastHeartbeatTime >= heartbeatIntervalMs || lastHeartbeatTime == 0)
        {
            lastHeartbeatTime = now;

            int uptimeSeconds = (now - startTime) / 1000;
            int rssi = WiFi.RSSI();
            int battery = getBatteryPercent();

            bool forceRefresh = !hasDisplayContent || isReconnecting;
            HeartbeatResult result = apiClient.sendHeartbeat(battery, rssi, uptimeSeconds, forceRefresh);

            // Factory reset
            if (result.factoryReset)
            {
                Serial.println("[Main] Remote factory reset requested!");
                led_Red();
                playBuzzerNegative();

                displaySystemScreen("RST", "Factory Reset", "Rebooting...");
                display.refresh();
                delay(2000);

                Preferences prefs;
                prefs.begin("tigermeter", false);
                prefs.clear();
                prefs.end();

                Serial.println("[Main] All data cleared, rebooting...");
                ESP.restart();
            }

            // Demo mode toggle
            if (result.demoMode != localDemoMode)
            {
                Serial.printf("[Main] Demo mode changed remotely: %s\n", result.demoMode ? "ON" : "OFF");

                Preferences prefs;
                prefs.begin("tigermeter", false);
                prefs.putBool("demoMode", result.demoMode);
                prefs.end();

                displaySystemScreen("DEMO", result.demoMode ? "Demo Enabled" : "Demo Disabled", "Rebooting...");
                display.refresh();

                if (result.demoMode) playBuzzerPositive();
                delay(2000);
                ESP.restart();
            }

            if (result.success)
            {
                consecutiveHeartbeatFailures = 0;

                if (isReconnecting) {
                    Serial.println("[Main] Connection restored!");
                    stopAmberPulse();
                    isReconnecting = false;
                }

                OtaUpdate::setAutoUpdate(result.autoUpdate);
                OtaUpdate::setLatestVersion(result.latestFirmwareVersion);
                if (result.firmwareDownloadUrl.length() > 0) {
                    OtaUpdate::setFirmwareUrl(result.firmwareDownloadUrl);
                }

                // --- NEW DISPLAY DATA ---
                if (result.hasNewDisplay && result.frameCount > 0)
                {
                    Serial.printf("[Main] New display: %d frames, interval=%us\n", result.frameCount, result.refreshInterval);

                    // Copy frames to local buffer
                    displayFrameCount = result.frameCount;
                    displayRefreshInterval = result.refreshInterval;
                    displayHash = result.displayHash;
                    hasDisplayContent = true;

                    // Copy frames (each is 8064 bytes)
                    for (int i = 0; i < result.frameCount; i++) {
                        memcpy(displayFrames[i].bitmap, result.frames[i].bitmap, DISPLAY_FRAME_SIZE);
                        strncpy(displayFrames[i].ledColor, result.frames[i].ledColor, 15);
                        displayFrames[i].ledColor[15] = '\0';
                        strncpy(displayFrames[i].ledBrightness, result.frames[i].ledBrightness, 7);
                        displayFrames[i].ledBrightness[7] = '\0';
                        displayFrames[i].durationSec = result.frames[i].durationSec;
                        displayFrames[i].beep = result.frames[i].beep;
                        displayFrames[i].flashCount = result.frames[i].flashCount;
                    }

                    // Reset rotation + one-shot tracking
                    currentFrameIndex = 0;
                    frameStartTime = now;
                    for (int i = 0; i < MAX_DISPLAY_FRAMES; i++) oneShotFired[i] = false;

                    // Draw first frame
                    if (displayFrames[0].durationSec > 0) {
                        displayFrameFullScreen(0);
                        applyFrameLedBeep(0);
                    }
                }
                else if (result.hasNewDisplay && result.frameCount == 0) {
                    // Empty frames — "waiting for content"
                    hasDisplayContent = false;
                    displayFrameCount = 0;
                    displayRefreshInterval = result.refreshInterval;
                    displayWaitingForContent();
                    display.refresh();
                    led_Off();
                    stopRainbow();
                }
                // else: no new display data, just keep rotating
            }
            else if (result.httpCode == 401 || result.httpCode == 403)
            {
                const char* reason = result.httpCode == 403 ? "Device revoked" : "Auth expired";
                Serial.printf("[Main] %s, restarting claim...\n", reason);
                consecutiveHeartbeatFailures = 0;
                if (isReconnecting) {
                    stopAmberPulse();
                    isReconnecting = false;
                }
                hasDisplayContent = false;
                displayFrameCount = 0;
                currentState = STATE_UNCLAIMED;
                currentClaimCode = "";
                lastDisplayedError = reason;
                led_Yellow();
            }
            else
            {
                consecutiveHeartbeatFailures++;
                Serial.printf("[Main] Heartbeat failed (%d consecutive failures): %s\n",
                              consecutiveHeartbeatFailures, result.errorMessage.c_str());

                if (consecutiveHeartbeatFailures >= 2 && hasDisplayContent && !isReconnecting)
                {
                    Serial.println("[Main] Server connection lost, entering reconnecting state");
                    isReconnecting = true;
                    displayReconnecting();
                    startAmberPulse();
                }
            }
        }

        // --- FRAME ROTATION ---
        if (hasDisplayContent && displayFrameCount > 0 && !isReconnecting) {
            uint8_t idx = currentFrameIndex;
            if (displayFrames[idx].durationSec > 0) {
                uint32_t elapsed = (now - frameStartTime) / 1000;
                if (elapsed >= displayFrames[idx].durationSec) {
                    // Advance to next frame
                    currentFrameIndex = (currentFrameIndex + 1) % displayFrameCount;
                    frameStartTime = now;
                    uint8_t newIdx = currentFrameIndex;
                    if (displayFrames[newIdx].durationSec > 0) {
                        displayFrameFullScreen(newIdx);
                        applyFrameLedBeep(newIdx);
                    }
                }
            } else {
                // Skip invalid frame (zero duration)
                currentFrameIndex = (currentFrameIndex + 1) % displayFrameCount;
                frameStartTime = now;
                if (displayFrames[currentFrameIndex].durationSec > 0) {
                    displayFrameFullScreen(currentFrameIndex);
                    applyFrameLedBeep(currentFrameIndex);
                }
            }
        }

        // Low battery warning
        if (hasDisplayContent && getBatteryPercent() < 5) {
            drawBatteryIcon(5, 5);
        }

        // --- OTA CHECK ---
        bool shouldCheckOta = false;
        if (!firstOtaCheckDone && OtaUpdate::getLatestVersion() > 0) {
            if (now - startTime >= FIRST_OTA_CHECK_DELAY_MS) {
                shouldCheckOta = true;
                firstOtaCheckDone = true;
                Serial.println("[OTA] First check (60s after boot)");
            }
        } else if (now - lastOtaCheckTime >= OTA_CHECK_INTERVAL_MS) {
            shouldCheckOta = true;
        }

        if (shouldCheckOta) {
            lastOtaCheckTime = now;

            if (OtaUpdate::isUpdateAvailable()) {
                Serial.printf("[Main] OTA update available: v%d -> v%d\n",
                              OtaUpdate::getCurrentVersion(),
                              OtaUpdate::getLatestVersion());

                displaySystemScreen("OTA", NULL, NULL);
                display.refresh();

                OtaResult otaResult = OtaUpdate::checkAndUpdate();

                if (otaResult.success) {
                    displaySystemScreen("OTA", "Update OK!", "Rebooting...");
                    display.refresh();

                    led_Green();
                    playBuzzerPositive();
                    delay(2000);
                    ESP.restart();
                } else if (otaResult.updateAvailable && otaResult.errorMessage.length() > 0) {
                    Serial.printf("[Main] OTA update failed: %s\n", otaResult.errorMessage.c_str());
                }
            }
        }
        break;
    }

    case STATE_ERROR:
        led_Yellow();
        lastDisplayedError = "Error";
        delay(5000);
        currentState = STATE_UNCLAIMED;
        break;
    }
}

void initializeDisplay()
{
    Serial.println("[Display] e-Paper Init...");
    display.begin();
    display.clear();
    display.refresh();
}

// Old drawRectangleAndText — KEPT for demo/system screens only
// (no longer used for main display, but preserved for compatibility with captive portal calls)
void drawRectangleAndText(const char *Text)
{
    display.fillRect(0, 0, 135, 168, true);
    display.setFontSize(32);
    display.setTextColor(false); // White on black
    int textW = display.getTextWidth(Text);
    int textH = display.getFontHeight();
    display.drawText((135 - textW) / 2, (168 - textH) / 2, Text);
}

// displayApiData — REMOVED (was text rendering, replaced by frame rotation)
// displayWifiMessage, displayClaimCode, displayIPAddress, displayError, displayReconnecting
// are defined above with displaySystemScreen()

// ============== RAINBOW LED TASK ==============
void rainbowTask(void *pvParameters)
{
    (void)pvParameters;
    for (;;)
    {
        if (!isRainbow) {
            rainbowTaskHandle = NULL;
            vTaskDelete(NULL);
            return;
        }
        rainbowCycle(6000);  // One full rainbow cycle
    }
}

void startRainbow()
{
    if (rainbowTaskHandle == NULL) {
        isRainbow = true;
        xTaskCreatePinnedToCore(rainbowTask, "rainbow", 2048, NULL, 1, &rainbowTaskHandle, 1);
        Serial.println("[Main] Started rainbow task");
    }
}

void stopRainbow()
{
    if (rainbowTaskHandle != NULL) {
        isRainbow = false;
        delay(100);
        if (rainbowTaskHandle != NULL) {
            vTaskDelete(rainbowTaskHandle);
            rainbowTaskHandle = NULL;
        }
        Serial.println("[Main] Stopped rainbow task");
    }
}

// ============== AMBER PULSE (reconnecting) ==============
void amberPulseTask(void *pvParameters)
{
    (void)pvParameters;
    for (;;)
    {
        if (!isReconnecting) {
            amberPulseTaskHandle = NULL;
            vTaskDelete(NULL);
            return;
        }
        pulseAmberSlow();  // One 3-second cycle
    }
}

void startAmberPulse()
{
    if (amberPulseTaskHandle == NULL) {
        xTaskCreatePinnedToCore(amberPulseTask, "amberPulse", 2048, NULL, 1, &amberPulseTaskHandle, 1);
        Serial.println("[Main] Started amber pulse task");
    }
}

void stopAmberPulse()
{
    if (amberPulseTaskHandle != NULL) {
        isReconnecting = false;
        delay(100);
        if (amberPulseTaskHandle != NULL) {
            vTaskDelete(amberPulseTaskHandle);
            amberPulseTaskHandle = NULL;
        }
        Serial.println("[Main] Stopped amber pulse task");
    }
}

// ============== DEMO MODE ==============
void getBatteryInfo(float &voltage, int &percent) {
    int raw = analogRead(35);
    voltage = (raw / 4095.0f) * 3.3f * BATTERY_MULTIPLIER;
    percent = (int)((voltage - 3.0f) / (4.1f - 3.0f) * 100.0f);
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
}

void renderDemoHeader()
{
    display.clear();
    drawRectangleAndText("DEMO");
}

void renderDemoUptime()
{
    unsigned long seconds = millis() / 1000UL;
    unsigned int hh = (seconds / 3600UL) % 100U;
    unsigned int mm = (seconds / 60UL) % 60U;
    unsigned int ss = seconds % 60U;

    char timeStr[9];
    snprintf(timeStr, sizeof(timeStr), "%02u:%02u:%02u", hh, mm, ss);

    int rightAreaStart = 135;
    int rightAreaWidth = VISUAL_WIDTH - 135;

    // Clear right area
    display.fillRect(rightAreaStart, 0, rightAreaWidth, VISUAL_HEIGHT, false);

    // Draw timer centered
    display.setFontSize(32);
    display.setTextColor(true);
    int textW = display.getTextWidth(timeStr);
    int x = rightAreaStart + (rightAreaWidth - textW) / 2;
    int y = (VISUAL_HEIGHT - display.getFontHeight()) / 2;
    display.drawText(x, y, timeStr);

    // Battery info
    float battVoltage;
    int battPercent;
    getBatteryInfo(battVoltage, battPercent);

    char battStr[16];
    snprintf(battStr, sizeof(battStr), "%.2fV %d%%", battVoltage, battPercent);

    display.setFontSize(16);
    int infoX = rightAreaStart + 5;
    display.drawText(infoX, 3, battStr);

    // WiFi status
    Preferences demoWifiPrefs;
    demoWifiPrefs.begin("tigermeter", true);
    String savedSsid = demoWifiPrefs.getString("ssid", "");
    demoWifiPrefs.end();

    char wifiStr[36];
    if (savedSsid.length() == 0) {
        snprintf(wifiStr, sizeof(wifiStr), "WiFi: (not set)");
    } else if (WiFi.status() == WL_CONNECTED) {
        snprintf(wifiStr, sizeof(wifiStr), "WiFi: %.14s OK", savedSsid.c_str());
    } else {
        snprintf(wifiStr, sizeof(wifiStr), "WiFi: %.14s --", savedSsid.c_str());
    }
    int line2Y = 3 + display.getFontHeight() + 2;
    display.drawText(infoX, line2Y, wifiStr);

    // IP address
    char ipStr[24];
    if (WiFi.status() == WL_CONNECTED) {
        snprintf(ipStr, sizeof(ipStr), "IP: %s", WiFi.localIP().toString().c_str());
    } else {
        snprintf(ipStr, sizeof(ipStr), "AP: %s", WiFi.softAPIP().toString().c_str());
    }
    int line3Y = line2Y + display.getFontHeight() + 2;
    display.drawText(infoX, line3Y, ipStr);

    // AP SSID
    char apSsidStr[32];
    snprintf(apSsidStr, sizeof(apSsidStr), "AP: %s", getApSsid().c_str());
    display.drawText(infoX, line3Y + display.getFontHeight() + 2, apSsidStr);

    // Firmware version
    char fwStr[16];
    snprintf(fwStr, sizeof(fwStr), "FW: v%d", CURRENT_FIRMWARE_VERSION);
    int fwY = VISUAL_HEIGHT - (display.getFontHeight() + 2) * 3 - 3;
    display.drawText(infoX, fwY, fwStr);

    // MAC address
    String mac = WiFi.macAddress();
    char macStr[24];
    snprintf(macStr, sizeof(macStr), "MAC: %s", mac.c_str());
    int macY = VISUAL_HEIGHT - (display.getFontHeight() + 2) * 2 - 3;
    display.drawText(infoX, macY, macStr);

    // Date
    int dateY = VISUAL_HEIGHT - display.getFontHeight() - 3;
    if (WiFi.status() == WL_CONNECTED) {
        time_t now = time(NULL);
        if (now > 1000000000) {
            struct tm *t = localtime(&now);
            char dateStr[20];
            strftime(dateStr, sizeof(dateStr), "%d %b %Y", t);
            display.drawText(infoX, dateY, dateStr);
        }
    }
}

void runDemoLoop()
{
    renderDemoHeader();
    renderDemoUptime();
    display.refresh();

    unsigned long lastUpdate = millis();
    unsigned long lastMacPrint = 0;
    const unsigned long MAC_PRINT_INTERVAL = 5000;
    static bool ntpInitialized = false;

    while (1)
    {
        if (!ntpInitialized && WiFi.status() == WL_CONNECTED) {
            configTime(0, 0, "pool.ntp.org", "time.nist.gov");
            ntpInitialized = true;
            Serial.println("[DEMO] NTP time initialized");
        }
        captivePortalLoop();

        unsigned long now = millis();

        if (now - lastMacPrint >= MAC_PRINT_INTERVAL)
        {
            lastMacPrint = now;

            unsigned long uptimeSec = now / 1000;
            unsigned int hh = (uptimeSec / 3600) % 100;
            unsigned int mm = (uptimeSec / 60) % 60;
            unsigned int ss = uptimeSec % 60;

            Serial.println("\n===== [DEMO] Debug Info =====");
            Serial.printf("[DEMO] Uptime: %02u:%02u:%02u\r\n", hh, mm, ss);
            Serial.println("[DEMO] MAC: " + WiFi.macAddress());
            Serial.printf("[DEMO] AP IP: %s\r\n", WiFi.softAPIP().toString().c_str());
            Serial.printf("[DEMO] Free Heap: %u bytes\r\n", ESP.getFreeHeap());
            Serial.printf("[DEMO] Connected clients: %d\r\n", WiFi.softAPgetStationNum());

            int batteryRaw = analogRead(35);
            float batteryVoltage = (batteryRaw / 4095.0) * 3.3;
            Serial.printf(" %.2fV (raw: %d)\r\n", batteryVoltage, batteryRaw);
            Serial.println("=============================");
        }

        if (now - lastUpdate >= 1000)
        {
            lastUpdate = now;
            renderDemoHeader();
            renderDemoUptime();
            display.refreshPartial();
        }

        delay(50);
    }
}

void demoLedTask(void *pvParameters)
{
    (void)pvParameters;
    const uint16_t pulseDuration = 3000;
    for (;;)
    {
        for (int i = 0; i < 7; i++)
        {
            pulseRainbowColor(i, pulseDuration);
        }
    }
}

#endif // API_MODE