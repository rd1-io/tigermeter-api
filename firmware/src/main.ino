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
#include "BinanceLogo.h"
#include "CurrencySymbols.h"
#include "DEV_Config.h"

// Display geometry (after rotation: 384x168)
const int VISUAL_WIDTH = DISPLAY_WIDTH;    // 384
const int VISUAL_HEIGHT = DISPLAY_HEIGHT;  // 168
const int RECT_WIDTH = 135;
const int RECT_HEIGHT = VISUAL_HEIGHT;

// API configuration
#ifndef API_BASE_URL
#define API_BASE_URL "https://api-tiger.rd1.io/api"
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

// Current display data
String displaySymbol = "";
int displaySymbolFontSize = 24;        // Font size in pixels (10-40) for symbol
String displaySymbolImage = "";        // Predefined logo name
bool displaySymbolCarousel = false;    // Carousel mode
uint8_t customBitmapBuffer[512];       // Buffer for custom logo bitmap (64x64 1-bit)
bool hasCustomBitmap = false;
String displayTopLine = "";
int displayTopLineFontSize = 16;       // Font size in pixels (10-40)
TextAlignType displayTopLineAlign = ALIGN_CENTER;
bool displayTopLineShowDate = false;
String displayMainText = "";
int displayMainTextFontSize = 32;      // Font size in pixels (8-40)
TextAlignType displayMainTextAlign = ALIGN_CENTER;
String displayBottomLine = "";
int displayBottomLineFontSize = 16;    // Font size in pixels (8-40)
TextAlignType displayBottomLineAlign = ALIGN_CENTER;
String displayLedColor = "green";
String displayLedBrightness = "mid";
int displayRefreshInterval = 30;
float displayTimezoneOffset = 3.0f;
String lastDisplayedError = "";

// Server connection tracking
int consecutiveHeartbeatFailures = 0;
bool isReconnecting = false;
bool wifiDisconnectedDisplayed = false;
TaskHandle_t amberPulseTaskHandle = NULL;
bool isRainbow = false;
TaskHandle_t rainbowTaskHandle = NULL;

// Symbol carousel
unsigned long lastCarouselSwitch = 0;
int carouselIndex = 0;
const int CAROUSEL_INTERVAL_MS = 8000;
// Carousel items: all bitmaps (predefined logo names)
const char* carouselItems[] = { "dollar", "euro", "pound", "yuan", "ruble", "bitcoin", "eth", "binance" };
const int CAROUSEL_COUNT = 8;

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
    display.drawRoundRect(x, y, 24, 12, 2, false);        // Battery body (white outline, rounded)
    display.fillRect(x + 24, y + 3, 3, 6, false);         // Battery tip (white, simple rect)
    display.fillRoundRect(x + 2, y + 2, 2, 8, 1, false);  // Low level (white bar ~10%, rounded)
}

// Function prototypes
void initializeDisplay();
void drawRectangleAndText(const char *Text);
void displayClaimCode(const char *code);
void displayApiData();
void displayWifiMessage();
void displayError(const char *msg);
void handleApiStateMachine();
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

// Note: toDisplayFontSize is no longer needed since we use numeric pixel sizes directly

// Convert API TextAlignType to Display TextAlign
static DisplayTextAlign toDisplayAlign(TextAlignType type) {
    switch (type) {
        case ALIGN_LEFT: return DISPLAY_ALIGN_LEFT;
        case ALIGN_RIGHT: return DISPLAY_ALIGN_RIGHT;
        case ALIGN_CENTER: 
        default: return DISPLAY_ALIGN_CENTER;
    }
}

void setup()
{
    Serial.begin(115200);
    delay(100);
    
    Serial.println("[Main] Starting TigerMeter (API MODE)...");
    
    startTime = millis();

    // Initialize LEDC for LED PWM control
    initializePins();
    
    // Immediately set LED to dim yellow (10% brightness)
    // This gives instant visual feedback during boot
    setLedPWM(229, 247, 255);

    // Initialize e-paper display
    Serial.println("[Main] Initializing e-paper display...");
    initializeDisplay();
    Serial.println("[Main] Display initialized");

    // Show logo with Binance logo and TIGERMETER text
    display.clear();
    
    // Draw Binance logo centered
    int logoX = (VISUAL_WIDTH - BINANCE_LOGO_WIDTH) / 2;
    int logoY = 25;
    display.drawBitmap(logoX, logoY, Binance_Logo, BINANCE_LOGO_WIDTH, BINANCE_LOGO_HEIGHT, true);
    
    // Draw "TIGER" in gray + "METER" in black
    display.setFont(FONT_SIZE_LARGE);
    int tigerW = display.getTextWidth("TIGER");
    int meterW = display.getTextWidth("METER");
    int totalW = tigerW + meterW;
    int textX = (VISUAL_WIDTH - totalW) / 2;
    int textY = logoY + BINANCE_LOGO_HEIGHT + 12;
    display.drawTextGray(textX, textY, "TIGER");
    display.setTextColor(true);
    display.drawText(textX + tigerW, textY, "METER");
    
    display.refresh();
    Serial.println("[Main] Logo displayed");
    
    // Fade in yellow LED from 10% to 100% while logo is shown
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

    // Try to connect using stored credentials (LED already yellow from fade in)
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
        Serial.println("[Main] WiFi connected, initializing NTP...");
        int tzOffsetSec = (int)(displayTimezoneOffset * 3600);
        configTime(tzOffsetSec, 0, "pool.ntp.org", "time.nist.gov");
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
    // WiFi reconnected — show IP and reset flag so we redraw if it drops again
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
            currentState = STATE_UNCLAIMED;
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
                
                // Show success message
                display.clear();
                drawRectangleAndText("OK");
                display.setFont(FONT_SIZE_MEDIUM);
                display.setTextColor(true);
                display.drawText(150, 72, "Connected!");
                display.refresh();
                delay(2000);
                
                lastHeartbeatTime = 0;
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
        // Retry NTP sync if time is still invalid
        static bool ntpSynced = false;
        if (!ntpSynced && WiFi.status() == WL_CONNECTED && time(nullptr) < 1000000000) {
            int tzOffsetSec = (int)(displayTimezoneOffset * 3600);
            configTime(tzOffsetSec, 0, "pool.ntp.org", "time.nist.gov");
        }
        if (time(nullptr) > 1000000000) {
            ntpSynced = true;
        }
        
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
            
            // Force refresh if no data yet, or if recovering from reconnecting state
            bool forceRefresh = (displaySymbol.length() == 0) || isReconnecting;
            HeartbeatResult result = apiClient.sendHeartbeat(battery, rssi, uptimeSeconds, forceRefresh);
            
            // Check for remote factory reset command
            if (result.factoryReset)
            {
                Serial.println("[Main] Remote factory reset requested!");
                led_Red();
                playBuzzerNegative();
                
                display.clear();
                drawRectangleAndText("RST");
                display.setFont(FONT_SIZE_MEDIUM);
                display.setTextColor(true);
                display.drawText(150, 50, "Factory Reset");
                display.setFont(FONT_SIZE_SMALL);
                display.drawText(150, 85, "Rebooting...");
                display.refresh();
                
                delay(2000);
                
                Preferences prefs;
                prefs.begin("tigermeter", false);
                prefs.clear();
                prefs.end();
                
                Serial.println("[Main] All data cleared, rebooting...");
                ESP.restart();
            }
            
            // Check for remote demo mode toggle
            if (result.demoMode != localDemoMode)
            {
                Serial.printf("[Main] Demo mode changed remotely: %s\n", result.demoMode ? "ON" : "OFF");
                
                Preferences prefs;
                prefs.begin("tigermeter", false);
                prefs.putBool("demoMode", result.demoMode);
                prefs.end();
                
                display.clear();
                drawRectangleAndText("DEMO");
                display.setFont(FONT_SIZE_MEDIUM);
                display.setTextColor(true);
                display.drawText(150, 50, result.demoMode ? "Demo Enabled" : "Demo Disabled");
                display.setFont(FONT_SIZE_SMALL);
                display.drawText(150, 85, "Rebooting...");
                display.refresh();
                
                if (result.demoMode) {
                    playBuzzerPositive();
                }
                delay(2000);
                ESP.restart();
            }
            
            if (result.success)
            {
                // Reset failure counter on success
                consecutiveHeartbeatFailures = 0;
                
                // If we were in reconnecting state, stop the amber pulse
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
                
                if (result.hasInstruction)
                {
                    bool symbolChanged = (displaySymbol != result.symbol) || (displaySymbol.length() == 0);
                    
                    displaySymbol = result.symbol;
                    displaySymbolFontSize = result.symbolFontSize;
                    displaySymbolImage = result.symbolImage;
                    displaySymbolCarousel = result.symbolCarousel;
                    // Decode custom bitmap if present
                    if (result.symbolBitmap.length() > 0) {
                        int decoded = base64Decode(result.symbolBitmap.c_str(), customBitmapBuffer, 512);
                        hasCustomBitmap = (decoded == 512);
                        if (hasCustomBitmap) {
                            Serial.println("[Main] Custom bitmap decoded: 512 bytes");
                        }
                    } else {
                        hasCustomBitmap = false;
                    }
                    displayTopLine = result.topLine;
                    displayTopLineFontSize = result.topLineFontSize;
                    displayTopLineAlign = result.topLineAlign;
                    displayTopLineShowDate = result.topLineShowDate;
                    displayMainText = result.mainText;
                    displayMainTextFontSize = result.mainTextFontSize;
                    displayMainTextAlign = result.mainTextAlign;
                    displayBottomLine = result.bottomLine;
                    displayBottomLineFontSize = result.bottomLineFontSize;
                    displayBottomLineAlign = result.bottomLineAlign;
                    displayLedColor = result.ledColor;
                    displayLedBrightness = result.ledBrightness;
                    displayRefreshInterval = result.refreshInterval;
                    
                    if (displayTimezoneOffset != result.timezoneOffset) {
                        displayTimezoneOffset = result.timezoneOffset;
                        int tzOffsetSec = (int)(displayTimezoneOffset * 3600);
                        configTime(tzOffsetSec, 0, "pool.ntp.org", "time.nist.gov");
                        Serial.printf("[Main] Timezone updated to UTC%+.1f\n", displayTimezoneOffset);
                    }
                    
                    displayApiData();
                    if (symbolChanged) {
                        display.refresh();
                        Serial.println("[Main] Full refresh (symbol changed)");
                    } else {
                        display.refreshPartial();
                    }
                    
                    // Stop rainbow if it was running before applying new color
                    stopRainbow();
                    
                    setLedBrightness(displayLedBrightness);
                    if (displayLedBrightness == "off") {
                        led_Off();
                    } else if (displayLedColor == "rainbow") startRainbow();
                    else if (displayLedColor == "green") led_Green();
                    else if (displayLedColor == "red") led_Red();
                    else if (displayLedColor == "blue") led_Blue();
                    else if (displayLedColor == "yellow") led_Yellow();
                    else if (displayLedColor == "purple") led_Purple();
                    
                    if (result.beep) {
                        playBuzzerPositive();
                    }
                    
                    if (result.flashCount > 0) {
                        for (int i = 0; i < result.flashCount; i++) {
                            pulseColorByName(displayLedColor, 800);
                            if (i < result.flashCount - 1) {
                                delay(100); // Small gap between pulses
                            }
                        }
                        // Restore LED to steady state after pulsing
                        setLedBrightness(displayLedBrightness);
                        if (displayLedBrightness == "off") {
                            led_Off();
                        } else if (displayLedColor == "rainbow") startRainbow();
                        else if (displayLedColor == "green") led_Green();
                        else if (displayLedColor == "red") led_Red();
                        else if (displayLedColor == "blue") led_Blue();
                        else if (displayLedColor == "yellow") led_Yellow();
                        else if (displayLedColor == "purple") led_Purple();
                    }
                }
                else
                {
                    if (displaySymbol.length() > 0)
                    {
                        displayApiData();
                        display.refreshPartial();
                    }
                    else
                    {
                        display.clear();
                        drawRectangleAndText("...");
                        display.setFont(FONT_SIZE_SMALL);
                        display.setTextColor(true);
                        display.drawText(150, 66, "Waiting for");
                        display.drawText(150, 88, "display data");
                        display.refresh();
                    }
                }
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
                // Clear cached display data so old content is not shown after re-claim
                displaySymbol = "";
                displayTopLine = "";
                displayMainText = "";
                displayBottomLine = "";
                displayTopLineShowDate = false;
                currentState = STATE_UNCLAIMED;
                currentClaimCode = "";
                lastDisplayedError = reason;
                led_Yellow();
            }
            else
            {
                // Server connection failed (not 401)
                consecutiveHeartbeatFailures++;
                Serial.printf("[Main] Heartbeat failed (%d consecutive failures): %s\n", 
                              consecutiveHeartbeatFailures, result.errorMessage.c_str());
                
                // After 2 consecutive failures, enter reconnecting state
                // Only if device had display data (was working before)
                if (consecutiveHeartbeatFailures >= 2 && displaySymbol.length() > 0 && !isReconnecting)
                {
                    Serial.println("[Main] Server connection lost, entering reconnecting state");
                    isReconnecting = true;
                    displayReconnecting();
                    startAmberPulse();
                }
            }
        }
        
        // Symbol carousel rotation (all items are bitmaps)
        if (displaySymbolCarousel && !isReconnecting) {
            if (now - lastCarouselSwitch >= CAROUSEL_INTERVAL_MS) {
                lastCarouselSwitch = now;
                carouselIndex = (carouselIndex + 1) % CAROUSEL_COUNT;
                
                // Redraw black rectangle with next bitmap
                display.fillRect(0, 0, RECT_WIDTH, RECT_HEIGHT, true);
                drawPredefinedLogo(carouselItems[carouselIndex]);
                display.refreshPartial();
            }
        }
        
        // Tick seconds
        static unsigned long lastTimeUpdate = 0;
        if (displayTopLineShowDate && displaySymbol.length() > 0) {
            if (now - lastTimeUpdate >= 1000) {
                lastTimeUpdate = now;
                displayApiData();
                display.refreshPartial();
            }
        }
        
        // Check for OTA updates
        // First check 60s after boot (if we have version info), then every hour
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
                
                // Show "Updating" message on display before starting OTA
                display.clear();
                drawRectangleAndText("OTA");
                display.setFont(FONT_SIZE_MEDIUM);
                display.setTextColor(true);
                char updateMsg[32];
                snprintf(updateMsg, sizeof(updateMsg), "Updating to v%d", OtaUpdate::getLatestVersion());
                display.drawText(150, 50, updateMsg);
                display.setFont(FONT_SIZE_SMALL);
                display.drawText(150, 85, "Please wait...");
                display.refresh();
                
                OtaResult otaResult = OtaUpdate::checkAndUpdate();
                
                if (otaResult.success) {
                    display.clear();
                    drawRectangleAndText("OTA");
                    display.setFont(FONT_SIZE_MEDIUM);
                    display.setTextColor(true);
                    display.drawText(150, 50, "Update OK!");
                    display.setFont(FONT_SIZE_SMALL);
                    display.drawText(150, 85, "Rebooting...");
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

// Base64 decode (inline, no external library)
static const uint8_t b64_table[128] = {
    64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,
    64,64,64,64,64,64,64,64,64,64,64,62,64,64,64,63,52,53,54,55,56,57,58,59,60,61,64,64,64,0,64,64,
    64,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,64,64,64,64,64,
    64,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,64,64,64,64,64
};

int base64Decode(const char* input, uint8_t* output, int maxOutputLen) {
    int len = strlen(input);
    int outIdx = 0;
    for (int i = 0; i < len && outIdx < maxOutputLen; i += 4) {
        uint32_t n = 0;
        int pad = 0;
        for (int j = 0; j < 4 && (i + j) < len; j++) {
            uint8_t c = (uint8_t)input[i + j];
            if (c == '=') { pad++; n <<= 6; }
            else if (c < 128) { n = (n << 6) | b64_table[c]; }
        }
        if (outIdx < maxOutputLen) output[outIdx++] = (n >> 16) & 0xFF;
        if (outIdx < maxOutputLen && pad < 2) output[outIdx++] = (n >> 8) & 0xFF;
        if (outIdx < maxOutputLen && pad < 1) output[outIdx++] = n & 0xFF;
    }
    return outIdx;
}

void initializeDisplay()
{
    Serial.println("[Display] e-Paper Init...");
    display.begin();
    display.clear();
    display.refresh();
}

// Draw predefined bitmap logo centered in rectangle (white on black background)
// Returns true if logo was drawn, false if name not recognized
// Get predefined bitmap by name. Returns null if not found.
const unsigned char* getPredefinedBitmap(const String& name, int& w, int& h, bool& rotate)
{
    rotate = false;
    if (name == "binance")  { w = BINANCE_LOGO_WIDTH;  h = BINANCE_LOGO_HEIGHT;  rotate = true; return Binance_Logo; }
    w = SYMBOL_BITMAP_WIDTH; h = SYMBOL_BITMAP_HEIGHT;
    if (name == "dollar")   return Symbol_dollar;
    if (name == "euro")     return Symbol_euro;
    if (name == "pound")    return Symbol_pound;
    if (name == "yuan")     return Symbol_yuan;
    if (name == "ruble")    return Symbol_ruble;
    if (name == "bitcoin")  return Symbol_bitcoin;
    if (name == "eth")      return Symbol_eth;
    return nullptr;
}

bool drawPredefinedLogo(const String& name)
{
    int bw, bh;
    bool rotate;
    const unsigned char* bmp = getPredefinedBitmap(name, bw, bh, rotate);
    if (!bmp) return false;
    int logoX = (RECT_WIDTH - bw) / 2;
    int logoY = (RECT_HEIGHT - bh) / 2;
    display.drawBitmap(logoX, logoY, bmp, bw, bh, rotate, true);
    return true;
}

void drawRectangleAndText(const char *Text)
{
    // Draw black rectangle on left side
    display.fillRect(0, 0, RECT_WIDTH, RECT_HEIGHT, true);
    
    // In carousel mode, draw current carousel item (not the fixed symbolImage)
    if (displaySymbolCarousel) {
        drawPredefinedLogo(carouselItems[carouselIndex]);
        return;
    }
    
    // Try custom bitmap from server
    if (hasCustomBitmap && displaySymbolImage.length() > 0) {
        int logoX = (RECT_WIDTH - SYMBOL_BITMAP_WIDTH) / 2;
        int logoY = (RECT_HEIGHT - SYMBOL_BITMAP_HEIGHT) / 2;
        display.drawBitmap(logoX, logoY, customBitmapBuffer, SYMBOL_BITMAP_WIDTH, SYMBOL_BITMAP_HEIGHT, false, true);
        return;
    }
    
    // Try predefined logo
    if (displaySymbolImage.length() > 0 && drawPredefinedLogo(displaySymbolImage)) {
        return;
    }
    
    // Fallback: draw text centered in rectangle (white on black)
    display.setFontSize(displaySymbolFontSize);
    display.setTextColor(false);  // White text
    int textW = display.getTextWidth(Text);
    int textH = display.getFontHeight();
    int textX = (RECT_WIDTH - textW) / 2;
    int textY = (RECT_HEIGHT - textH) / 2;
    display.drawText(textX, textY, Text);
}

void displayClaimCode(const char *code)
{
    display.clear();
    drawRectangleAndText("CODE");
    
    // Display code in right area
    display.setFont(FONT_SIZE_LARGE);
    display.setTextColor(true);
    int rightAreaStart = RECT_WIDTH;
    int rightAreaWidth = VISUAL_WIDTH - RECT_WIDTH;
    int codeW = display.getTextWidth(code);
    int codeH = display.getFontHeight();
    int codeX = rightAreaStart + (rightAreaWidth - codeW) / 2;
    int codeY = (VISUAL_HEIGHT - codeH) / 2;
    display.drawText(codeX, codeY, code);
}

void displayApiData()
{
    display.clear();
    
    // Left bar with symbol
    char symbolStr[8];
    strncpy(symbolStr, displaySymbol.c_str(), 7);
    symbolStr[7] = '\0';
    drawRectangleAndText(symbolStr);
    
    // Right area dimensions
    int rightAreaStart = RECT_WIDTH + 5;
    int rightAreaWidth = VISUAL_WIDTH - RECT_WIDTH - 10;
    
    // Top line
    char topStr[32];
    if (displayTopLineShowDate) {
        time_t now = time(NULL);
        struct tm *t = localtime(&now);
        strftime(topStr, sizeof(topStr), "%H:%M:%S %d %b", t);
    } else {
        strncpy(topStr, displayTopLine.c_str(), 31);
        topStr[31] = '\0';
    }
    if (strlen(topStr) > 0) {
        display.setFontSize(displayTopLineFontSize);  // Use numeric pixel size
        display.setTextColor(true);
        display.drawTextAligned(rightAreaStart, 8, rightAreaWidth, topStr, toDisplayAlign(displayTopLineAlign));
    }
    
    // Main text (supports \n for multiline)
    display.setFontSize(displayMainTextFontSize);
    display.setTextColor(true);
    int mainLineH = display.getFontHeight();
    
    // Count lines and split by \n
    String mainTextCopy = displayMainText;
    mainTextCopy.replace("\\n", "\n");  // Handle literal \n from JSON
    int lineCount = 1;
    for (int i = 0; i < (int)mainTextCopy.length(); i++) {
        if (mainTextCopy[i] == '\n') lineCount++;
    }
    int lineSpacing = 4;
    int totalTextH = lineCount * mainLineH + (lineCount - 1) * lineSpacing;
    int mainStartY = (VISUAL_HEIGHT - totalTextH) / 2;
    
    int lineIdx = 0;
    int startPos = 0;
    for (int i = 0; i <= (int)mainTextCopy.length(); i++) {
        if (i == (int)mainTextCopy.length() || mainTextCopy[i] == '\n') {
            String line = mainTextCopy.substring(startPos, i);
            char lineStr[64];
            strncpy(lineStr, line.c_str(), 63);
            lineStr[63] = '\0';
            int lineY = mainStartY + lineIdx * (mainLineH + lineSpacing);
            display.drawTextAligned(rightAreaStart, lineY, rightAreaWidth, lineStr, toDisplayAlign(displayMainTextAlign));
            lineIdx++;
            startPos = i + 1;
        }
    }
    
    // Bottom line
    char bottomStr[32];
    strncpy(bottomStr, displayBottomLine.c_str(), 31);
    bottomStr[31] = '\0';
    if (strlen(bottomStr) > 0) {
        display.setFontSize(displayBottomLineFontSize);  // Use numeric pixel size
        display.setTextColor(true);
        int bottomH = display.getFontHeight();
        int bottomY = VISUAL_HEIGHT - bottomH - 8;
        display.drawTextAligned(rightAreaStart, bottomY, rightAreaWidth, bottomStr, toDisplayAlign(displayBottomLineAlign));
    }
    
    // Low battery warning
    int batteryLevel = getBatteryPercent();
    if (batteryLevel < 10) {
        drawBatteryIcon(5, 5);
    }
}

void displayWifiMessage()
{
    display.clear();
    drawRectangleAndText("WiFi");
    
    display.setFont(FONT_SIZE_MEDIUM);
    display.setTextColor(true);
    display.drawText(150, 55, getApSsid().c_str());
    display.setFont(FONT_SIZE_SMALL);
    display.drawText(150, 100, "192.168.4.1");
}

void displayIPAddress()
{
    String ip = WiFi.localIP().toString();
    Serial.println("[Main] Showing IP address: " + ip);
    
    display.clear();
    drawRectangleAndText("IP");
    
    display.setFont(FONT_SIZE_MEDIUM);
    display.setTextColor(true);
    int rightAreaStart = RECT_WIDTH;
    int rightAreaWidth = VISUAL_WIDTH - RECT_WIDTH;
    int textW = display.getTextWidth(ip.c_str());
    int textH = display.getFontHeight();
    int x = rightAreaStart + (rightAreaWidth - textW) / 2;
    int y = (VISUAL_HEIGHT - textH) / 2;
    display.drawText(x, y, ip.c_str());
    
    display.refresh();
    delay(1000);
}

void displayError(const char *msg)
{
    display.clear();
    drawRectangleAndText("ERR");
    
    char truncMsg[24];
    strncpy(truncMsg, msg, 23);
    truncMsg[23] = '\0';
    
    display.setFont(FONT_SIZE_SMALL);
    display.setTextColor(true);
    display.drawText(150, 75, truncMsg);
}

// Display reconnecting state (server connection lost)
void displayReconnecting()
{
    display.clear();
    drawRectangleAndText("ERR");
    
    display.setFont(FONT_SIZE_MEDIUM);
    display.setTextColor(true);
    display.drawText(150, 72, "Reconnecting...");
    display.refresh();
}

// Amber pulse task for reconnecting state
void amberPulseTask(void *pvParameters)
{
    (void)pvParameters;
    for (;;)
    {
        if (!isReconnecting) {
            // Exit task when no longer reconnecting
            amberPulseTaskHandle = NULL;
            vTaskDelete(NULL);
            return;
        }
        pulseAmberSlow();  // One 3-second cycle
    }
}

// Start amber pulse task
void startAmberPulse()
{
    if (amberPulseTaskHandle == NULL) {
        xTaskCreatePinnedToCore(amberPulseTask, "amberPulse", 2048, NULL, 1, &amberPulseTaskHandle, 1);
        Serial.println("[Main] Started amber pulse task");
    }
}

// Stop amber pulse task
void stopAmberPulse()
{
    if (amberPulseTaskHandle != NULL) {
        isReconnecting = false;  // Signal task to exit
        // Give task time to finish current cycle and delete itself
        delay(100);
        if (amberPulseTaskHandle != NULL) {
            vTaskDelete(amberPulseTaskHandle);
            amberPulseTaskHandle = NULL;
        }
        Serial.println("[Main] Stopped amber pulse task");
    }
}

// Rainbow LED task
void rainbowLedTask(void *pvParameters)
{
    (void)pvParameters;
    for (;;)
    {
        if (!isRainbow) {
            rainbowTaskHandle = NULL;
            vTaskDelete(NULL);
            return;
        }
        rainbowCycle(6000);  // 6-second full cycle
    }
}

void startRainbow()
{
    if (rainbowTaskHandle == NULL) {
        isRainbow = true;
        xTaskCreatePinnedToCore(rainbowLedTask, "rainbow", 2048, NULL, 1, &rainbowTaskHandle, 1);
        Serial.println("[Main] Started rainbow LED task");
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
        Serial.println("[Main] Stopped rainbow LED task");
    }
}

// ============== DEMO MODE FUNCTIONS ==============
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

    int rightAreaStart = RECT_WIDTH;
    int rightAreaWidth = VISUAL_WIDTH - RECT_WIDTH;
    
    // Clear right area
    display.fillRect(rightAreaStart, 0, rightAreaWidth, VISUAL_HEIGHT, false);
    
    // Draw timer centered
    display.setFont(FONT_SIZE_LARGE);
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
    
    display.setFont(FONT_SIZE_SMALL);
    int infoX = rightAreaStart + 5;
    display.drawText(infoX, 3, battStr);
    
    // WiFi status — always show saved SSID
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
    
    // AP SSID (captive portal network name)
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
            int tzOffsetSec = (int)(displayTimezoneOffset * 3600);
            configTime(tzOffsetSec, 0, "pool.ntp.org", "time.nist.gov");
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

#elif defined(GXEPD2_TEST)
// ============== GxEPD2 TEST MODE ==============
#include "Display.h"

void setup()
{
    Serial.begin(115200);
    delay(100);
    Serial.println();
    Serial.println("GxEPD2 + U8g2 Test for GDEY029T71H");

    display.begin();
    
    // Test screen with Cyrillic
    display.clear();
    
    display.setFont(FONT_SIZE_MEDIUM);
    display.setTextColor(true);
    display.drawText(10, 30, "GxEPD2 + U8g2 Test");
    display.drawText(10, 60, "Привет мир!");
    
    display.setFont(FONT_SIZE_SMALL);
    display.drawText(10, 90, "GDEY029T71H 384x168");
    display.drawText(10, 110, "UTF-8: Тест кириллицы");
    
    // Draw a rectangle
    display.drawRect(5, 5, 200, 130, true);
    
    display.refresh();
    Serial.println("Display test complete!");
}

void loop()
{
    delay(1000);
}

#endif // GXEPD2_TEST
