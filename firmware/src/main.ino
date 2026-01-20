// Global firmware version, shared with CaptivePortal.cpp
extern const int CURRENT_FIRMWARE_VERSION = 2;

// ============== API MODE ==============
#ifdef API_MODE
#include <WiFiManager.h>
#include "DEV_Config.h"
#include "EPD.h"
#include "GUI_Paint.h"
#include <stdlib.h>
#include <time.h>
#include <WiFi.h>
#include "CaptivePortal.h"
#include "utility/LedColorsAndNoises.h"
#include "utility/ApiClient.h"

// Display geometry (GDEY029T71H 384x168)
const int DISPLAY_WIDTH = EPD_GDEY029T71H_WIDTH;
const int DISPLAY_HEIGHT = EPD_GDEY029T71H_HEIGHT;
const int VISUAL_WIDTH = DISPLAY_HEIGHT;   // 384
const int VISUAL_HEIGHT = DISPLAY_WIDTH;   // 168
const int RECT_WIDTH = 135;
const int RECT_HEIGHT = VISUAL_HEIGHT;

// API configuration - CHANGE THIS to your computer's IP
#ifndef API_BASE_URL
#define API_BASE_URL "http://192.168.1.100:3001/api"
#endif

// Timing
const unsigned long POLL_INTERVAL_MS = 3000;      // Poll every 3 seconds
const unsigned long HEARTBEAT_INTERVAL_MS = 30000; // Heartbeat every 30 seconds
const unsigned long WIFI_CHECK_INTERVAL_MS = 60000;

// Global state
ApiClient apiClient(API_BASE_URL);
UBYTE *BlackImage = NULL;
DeviceState currentState = STATE_UNCLAIMED;
unsigned long lastPollTime = 0;
unsigned long lastHeartbeatTime = 0;
unsigned long startTime = 0;
String currentClaimCode = "";

// Current display data
String displayName = "";
float displayPrice = 0.0f;
String displayCurrency = "$";
String displayLedColor = "";
float displayPortfolioValue = 0.0f;
float displayChangePercent = 0.0f;

// Function prototypes
void initializeEPaper();
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
void playBuzzerPositive();
void playBuzzerNegative();
void initializePins();

void setup()
{
    Serial.begin(115200);
    delay(100);
    Debug("Starting TigerMeter (API MODE)...\r\n");
    
    startTime = millis();

    // Initialize pins and buzzer
    initializePins();
    led_Purple();
    playBuzzerPositive();

    // Initialize e-paper display
    initializeEPaper();

    // Allocate memory for the image
    UWORD Imagesize = ((DISPLAY_WIDTH % 8 == 0) ? (DISPLAY_WIDTH / 8) : (DISPLAY_WIDTH / 8 + 1)) * DISPLAY_HEIGHT;
    if ((BlackImage = (UBYTE *)malloc(Imagesize)) == NULL)
    {
        Debug("Failed to apply for black memory...\r\n");
        while (1);
    }

    // Show logo
    Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    Paint_DrawString_EN(45, 40, "TIGERMETER", &Font38, WHITE, BLACK);
    EPD_Display(BlackImage);
    delay(2000);

    // Start captive portal AP + OTA
    startCaptivePortal();

    // Show WiFi message
    displayWifiMessage();
    EPD_Display(BlackImage);

    // Try to connect using stored credentials
    led_Yellow();
    unsigned long startAttemptTime = millis();
    const unsigned long connectionTimeout = 20000;
    while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < connectionTimeout)
    {
        captivePortalLoop();
        DEV_Delay_ms(100);
    }

    // Initialize API client
    apiClient.begin();
    
    // Check if we have stored credentials
    if (apiClient.hasCredentials()) {
        currentState = STATE_ACTIVE;
        Serial.println("[Main] Found stored credentials, entering ACTIVE state");
        led_Green();
    } else {
        currentState = STATE_UNCLAIMED;
        Serial.println("[Main] No credentials, entering UNCLAIMED state");
    }

    // Main loop runs in setup() for API mode
    while (1)
    {
        captivePortalLoop();
        handleApiStateMachine();
        DEV_Delay_ms(50);
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
        led_Purple();
        displayWifiMessage();
        EPD_Display_Partial(BlackImage);
        return;
    }

    switch (currentState)
    {
    case STATE_UNCLAIMED:
    {
        Serial.println("[Main] STATE_UNCLAIMED - issuing claim...");
        led_Blue();
        
        ClaimResult result = apiClient.issueClaim();
        
        if (result.success)
        {
            currentClaimCode = result.code;
            currentState = STATE_CLAIMING;
            displayClaimCode(result.code.c_str());
            EPD_Display(BlackImage);
            Serial.println("[Main] Got claim code: " + result.code);
            playBuzzerPositive();
        }
        else
        {
            Serial.println("[Main] Claim failed: " + result.errorMessage);
            displayError(result.errorMessage.c_str());
            EPD_Display_Partial(BlackImage);
            led_Red();
            DEV_Delay_ms(5000);
            currentState = STATE_UNCLAIMED; // Retry
        }
        break;
    }
    
    case STATE_CLAIMING:
        // Show code and transition to waiting
        currentState = STATE_WAITING_ATTACH;
        lastPollTime = now;
        break;
    
    case STATE_WAITING_ATTACH:
    {
        // Poll for attach
        if (now - lastPollTime >= POLL_INTERVAL_MS)
        {
            lastPollTime = now;
            led_Blue();
            
            PollResult result = apiClient.pollClaim();
            
            if (result.claimed)
            {
                // Got secret!
                currentState = STATE_ACTIVE;
                Serial.println("[Main] Claimed! Device ID: " + result.deviceId);
                led_Green();
                playBuzzerPositive();
                
                // Show success message briefly
                Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
                Paint_SelectImage(BlackImage);
                Paint_Clear(WHITE);
                drawRectangleAndText("OK");
                Paint_DrawString_EN(150, 60, "Connected!", &Font24, WHITE, BLACK);
                EPD_Display(BlackImage);
                DEV_Delay_ms(2000);
                
                lastHeartbeatTime = 0; // Force immediate heartbeat
            }
            else if (result.pending)
            {
                // Still waiting - blink LED
                static bool ledOn = false;
                ledOn = !ledOn;
                if (ledOn) led_Blue(); else led_Purple();
            }
            else if (result.expired || result.notFound)
            {
                // Code expired or consumed - get new one
                Serial.println("[Main] Claim expired/consumed, restarting...");
                currentClaimCode = "";
                currentState = STATE_UNCLAIMED;
                led_Yellow();
            }
        }
        break;
    }
    
    case STATE_ACTIVE:
    {
        // Send heartbeats
        if (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS || lastHeartbeatTime == 0)
        {
            lastHeartbeatTime = now;
            
            int uptimeSeconds = (now - startTime) / 1000;
            int rssi = WiFi.RSSI();
            int battery = 100; // Mock battery
            
            HeartbeatResult result = apiClient.sendHeartbeat(battery, rssi, uptimeSeconds);
            
            if (result.success)
            {
                if (result.hasInstruction)
                {
                    // Update display with new data
                    displayName = result.name;
                    displayPrice = result.price;
                    displayCurrency = result.currencySymbol;
                    displayLedColor = result.ledColor;
                    displayPortfolioValue = result.portfolioValue;
                    displayChangePercent = result.portfolioChangePercent;
                    
                    displayApiData();
                    EPD_Display(BlackImage);
                    
                    // Set LED color
                    if (displayLedColor == "green") led_Green();
                    else if (displayLedColor == "red") led_Red();
                    else if (displayLedColor == "blue") led_Blue();
                    else if (displayLedColor == "yellow") led_Yellow();
                    else if (displayLedColor == "purple") led_Purple();
                    
                    playBuzzerPositive();
                }
                else
                {
                    // No changes - show current data if we have any
                    if (displayName.length() > 0)
                    {
                        displayApiData();
                        EPD_Display_Partial(BlackImage);
                    }
                    else
                    {
                        // Waiting for first instruction
                        Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
                        Paint_SelectImage(BlackImage);
                        Paint_Clear(WHITE);
                        drawRectangleAndText("...");
                        Paint_DrawString_EN(150, 50, "Waiting for", &Font16, WHITE, BLACK);
                        Paint_DrawString_EN(150, 75, "display data", &Font16, WHITE, BLACK);
                        EPD_Display_Partial(BlackImage);
                    }
                }
            }
            else if (result.httpCode == 401)
            {
                // Secret revoked - go back to claim
                Serial.println("[Main] Secret revoked, restarting claim...");
                currentState = STATE_UNCLAIMED;
                currentClaimCode = "";
                led_Yellow();
            }
        }
        break;
    }
    
    case STATE_ERROR:
        led_Red();
        DEV_Delay_ms(5000);
        currentState = STATE_UNCLAIMED;
        break;
    }
}

void initializeEPaper()
{
    Debug("e-Paper Init and Clear...\r\n");
    DEV_Module_Init();
    EPD_Init();
    EPD_Clear();
}

void drawRectangleAndText(const char *Text)
{
    Paint_DrawRectangle(0, 0, RECT_WIDTH, RECT_HEIGHT, BLACK, DOT_PIXEL_1X1, DRAW_FILL_FULL);
    int textX = (RECT_WIDTH - Font32.Width * strlen(Text)) / 2;
    int textY = (RECT_HEIGHT - Font32.Height) / 2 - 2;
    Paint_DrawString_EN(textX, textY, Text, &Font32, BLACK, WHITE);
}

void displayClaimCode(const char *code)
{
    Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    
    // Left bar with "CODE"
    drawRectangleAndText("CODE");
    
    // Display the 6-digit code large and centered in the right area
    const sFONT *fontCode = &Font40;
    int rightAreaStart = RECT_WIDTH;
    int rightAreaWidth = VISUAL_WIDTH - RECT_WIDTH;
    int codeWidth = fontCode->Width * strlen(code);
    int codeX = rightAreaStart + (rightAreaWidth - codeWidth) / 2;
    int codeY = (VISUAL_HEIGHT - fontCode->Height) / 2;
    
    Paint_DrawString_EN(codeX, codeY, code, (sFONT *)fontCode, WHITE, BLACK);
    
    // Instructions below
    const sFONT *fontSmall = &Font16;
    Paint_DrawString_EN(rightAreaStart + 10, codeY + fontCode->Height + 15, 
                       "Enter code in portal", (sFONT *)fontSmall, WHITE, BLACK);
}

void displayApiData()
{
    Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    
    // Left bar with ticker name
    char ticker[8];
    strncpy(ticker, displayName.c_str(), 7);
    ticker[7] = '\0';
    drawRectangleAndText(ticker);
    
    // Price
    char priceStr[16];
    snprintf(priceStr, sizeof(priceStr), "%s%.2f", displayCurrency.c_str(), displayPrice);
    const sFONT *fontPrice = &Font40;
    int rightAreaStart = RECT_WIDTH + 10;
    Paint_DrawString_EN(rightAreaStart, 30, priceStr, (sFONT *)fontPrice, WHITE, BLACK);
    
    // Portfolio value and change
    char portfolioStr[32];
    snprintf(portfolioStr, sizeof(portfolioStr), "%s%.0f", displayCurrency.c_str(), displayPortfolioValue);
    Paint_DrawString_EN(rightAreaStart, 85, portfolioStr, &Font24, WHITE, BLACK);
    
    // Change percent
    char changeStr[16];
    const char *sign = displayChangePercent >= 0 ? "+" : "";
    snprintf(changeStr, sizeof(changeStr), "%s%.2f%%", sign, displayChangePercent);
    Paint_DrawString_EN(rightAreaStart, 120, changeStr, &Font24, WHITE, BLACK);
    
    // Timestamp
    time_t now = time(NULL);
    struct tm *current_time = localtime(&now);
    char timeStr[16];
    strftime(timeStr, sizeof(timeStr), "%H:%M", current_time);
    Paint_DrawString_EN(VISUAL_WIDTH - 70, 5, timeStr, &Font16, WHITE, BLACK);
}

void displayWifiMessage()
{
    Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    
    drawRectangleAndText("WiFi");
    
    const sFONT *fontNetwork = &Font24;
    Paint_DrawString_EN(150, 55, "tigermeter", (sFONT *)fontNetwork, WHITE, BLACK);
    Paint_DrawString_EN(150, 100, "192.168.4.1", &Font16, WHITE, BLACK);
}

void displayError(const char *msg)
{
    Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    
    drawRectangleAndText("ERR");
    
    // Truncate message if too long
    char truncMsg[24];
    strncpy(truncMsg, msg, 23);
    truncMsg[23] = '\0';
    
    Paint_DrawString_EN(150, 70, truncMsg, &Font16, WHITE, BLACK);
}

#elif defined(GXEPD2_TEST)
// ============== GxEPD2 TEST MODE ==============
// GxEPD2 includes all drivers in the main header
#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold9pt7b.h>

// Using custom SPI pins
#define EPD_SCK_PIN 33
#define EPD_MOSI_PIN 32
#define EPD_CS_PIN 26
#define EPD_RST_PIN 14
#define EPD_DC_PIN 27
#define EPD_BUSY_PIN 13

// GxEPD2 display object - using T94 driver (similar to GDEY029T71H)
GxEPD2_BW<GxEPD2_290_T94, GxEPD2_290_T94::HEIGHT> display(
    GxEPD2_290_T94(EPD_CS_PIN, EPD_DC_PIN, EPD_RST_PIN, EPD_BUSY_PIN));

SPIClass hspi(HSPI);

void setup()
{
    Serial.begin(115200);
    delay(100);
    Serial.println();
    Serial.println("GxEPD2 Test for GDEY029T71H");

    // Initialize custom SPI
    hspi.begin(EPD_SCK_PIN, -1, EPD_MOSI_PIN, EPD_CS_PIN);
    display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));

    display.init(115200);
    display.setRotation(1);  // Landscape
    display.setFont(&FreeMonoBold9pt7b);
    display.setTextColor(GxEPD_BLACK);

    // Full window test
    display.setFullWindow();
    display.firstPage();
    do {
        display.fillScreen(GxEPD_WHITE);
        display.setCursor(10, 30);
        display.print("GxEPD2 Test");
        display.setCursor(10, 60);
        display.print("GDEY029T71H");
        display.setCursor(10, 90);
        display.print("384 x 168");
        // Draw a rectangle
        display.drawRect(5, 5, 200, 100, GxEPD_BLACK);
    } while (display.nextPage());

    Serial.println("Display test complete!");
}

void loop()
{
    // Nothing to do
    delay(1000);
}

#else
// ============== NORMAL MODE ==============
#include <WiFiManager.h> // https://github.com/tzapu/WiFiManager
#include "DEV_Config.h"
#include "EPD.h"
#include "GUI_Paint.h"
#include <stdlib.h>
#include <time.h> // For time-related functions
#include <HTTPClient.h>
#include <ArduinoJson.h> // Include the necessary header file for DynamicJsonDocument
#include "utility/FirmwareUpdate.h"
#include "utility/LedColorsAndNoises.h"
#include <WiFi.h>
#include "CaptivePortal.h"

// Display geometry (GDEY029T71H 384x168)
const int DISPLAY_WIDTH = EPD_GDEY029T71H_WIDTH;
const int DISPLAY_HEIGHT = EPD_GDEY029T71H_HEIGHT;

// Layout constants
// With 270° rotation: visual display is DISPLAY_HEIGHT × DISPLAY_WIDTH (384 × 168)
const int VISUAL_WIDTH = DISPLAY_HEIGHT;   // 384
const int VISUAL_HEIGHT = DISPLAY_WIDTH;   // 168
const int RECT_WIDTH = 135;                // Left black bar width (50% wider)
const int RECT_HEIGHT = VISUAL_HEIGHT;     // Left black bar height (full visual height)
const int DATE_TIME_X = 102;               // Start of right content area
const int DATE_TIME_Y = 0;
const int UPDATE_INTERVAL_MS = 1000;
const int FULL_UPDATE_INTERVAL = 20;
const char *firmware_bin_url = "https://github.com/Pavel-Demidyuk/tigermeter_releases/releases/latest";

// Function Prototypes
void initializePins();
void initializeEPaper();
void drawInitialScreen(UBYTE *BlackImage, const char *Text);
void updateDisplay(UBYTE *BlackImage, int iteration);
void drawRectangleAndText(const char *Text);
void displayDateTime(UBYTE *BlackImage);
void displayRandomNumber(UBYTE *BlackImage);
void displayProfitOrLoss(UBYTE *BlackImage);
void displayConnectToWifiMessage(UBYTE *BlackImage);
void playBuzzerPositive();
void playBuzzerNegative();
void led_Purple();
void led_Red();
void led_Green();
void led_Yellow();
void pulseRainbowColor(int colorIndex, uint16_t durationMs);
void updateFirmware();

// Demo helpers
void showStrongestWifi(UBYTE *BlackImage);
void renderDemoHeader(UBYTE *BlackImage);
void renderUptime(UBYTE *BlackImage);
void runDemoLoop(UBYTE *BlackImage);
void ledBlinkTask(void *pvParameters);

void setup()
{
#ifdef DEMO_MODE
    Debug("Starting TigerMeter (DEMO)...\r\n");

    // Initialize pins and buzzer
    initializePins();
    led_Purple();
    playBuzzerPositive();

    // Initialize e-paper display
    initializeEPaper();

    // Allocate memory for the image
    UBYTE *BlackImage;
    UWORD Imagesize = ((DISPLAY_WIDTH % 8 == 0) ? (DISPLAY_WIDTH / 8) : (DISPLAY_WIDTH / 8 + 1)) * DISPLAY_HEIGHT;
    if ((BlackImage = (UBYTE *)malloc(Imagesize)) == NULL)
    {
        Debug("Failed to apply for black memory...\r\n");
        while (1)
            ;
    }

    // Step 1: Show strongest WiFi network for 10 seconds
    showStrongestWifi(BlackImage);

    // Start captive portal AP + OTA
    startCaptivePortal();

    // Start background LED blink task (runs independently)
    xTaskCreatePinnedToCore(ledBlinkTask, "ledBlink", 2048, NULL, 1, NULL, 1);

    // Step 2: Show main demo screen (DEMO bar + timer) and loop
    runDemoLoop(BlackImage);
#else

    Debug("Starting TigerMeter...\r\n");

    // Initialize pins and buzzer
    initializePins();

    led_Purple(); // Turn on purple LED on load
    playBuzzerPositive();

    // Initialize e-paper display
    initializeEPaper();

    // Allocate memory for the image
    UBYTE *BlackImage;
    UWORD Imagesize = ((DISPLAY_WIDTH % 8 == 0) ? (DISPLAY_WIDTH / 8) : (DISPLAY_WIDTH / 8 + 1)) * DISPLAY_HEIGHT;
    if ((BlackImage = (UBYTE *)malloc(Imagesize)) == NULL)
    {
        Debug("Failed to apply for black memory...\r\n");
        while (1)
            ;
    }

    drawLogoScreen(BlackImage);
    delay(500);
    // return;

    // Start captive portal AP + OTA
    startCaptivePortal();

    // Display initial WiFi message
    drawInitialScreen(BlackImage, "WiFi");
    displayConnectToWifiMessage(BlackImage);
    EPD_Display_Partial(BlackImage);

    // Try to connect using any stored credentials while keeping AP active
    led_Yellow();
    unsigned long startAttemptTime = millis();
    const unsigned long connectionTimeout = 15000;
    while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < connectionTimeout)
    {
        captivePortalLoop();
        DEV_Delay_ms(100);
    }

    static bool timeInitialized = false;
    if (WiFi.status() == WL_CONNECTED)
    {
        initNTPTime();
        timeInitialized = true;
    }

    // Display main screen (will show BTC data once WiFi/NTP are ready)
    drawInitialScreen(BlackImage, "BTC");
    int iteration = 0;
    while (1)
    {
        captivePortalLoop();
        // Initialize time later if WiFi becomes available after user configures it
        if (!timeInitialized && WiFi.status() == WL_CONNECTED)
        {
            initNTPTime();
            timeInitialized = true;
        }
        updateDisplay(BlackImage, iteration);
        iteration++;
        DEV_Delay_ms(UPDATE_INTERVAL_MS);
    }
#endif
}

void loop()
{
    // put your main code here, to run repeatedly:
}

void initializeEPaper()
{
    Debug("e-Paper Init and Clear...\r\n");
    DEV_Module_Init();
    EPD_Init();
    EPD_Clear();
}

void drawLogoScreen(UBYTE *BlackImage)
{
    initializeEPaper();
    Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    int textX = 45;
    int textY = 40;
    Paint_DrawString_EN(textX, textY, "TIGERMETER", &Font38, WHITE, BLACK);
    EPD_Display(BlackImage);
}

void drawInitialScreen(UBYTE *BlackImage, const char *Text)
{
    initializeEPaper();
    Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    drawRectangleAndText(Text);
    // EPD_Display(BlackImage);
}

void drawRectangleAndText(const char *Text)
{
    Paint_DrawRectangle(0, 0, RECT_WIDTH, RECT_HEIGHT, BLACK, DOT_PIXEL_1X1, DRAW_FILL_FULL);
    int textX = (RECT_WIDTH - Font40.Width * strlen(Text)) / 2;
    int textY = (RECT_HEIGHT - Font40.Height) / 2 - 2;
    Paint_DrawString_EN(textX, textY, Text, &Font40, BLACK, WHITE);
}

void updateDisplay(UBYTE *BlackImage, int iteration)
{
    // Check WiFi connection every minute
    if (iteration % (60000 / UPDATE_INTERVAL_MS) == 0)
    {
        if (WiFi.status() != WL_CONNECTED)
        {
            // Display "Connect to WiFi" message
            drawInitialScreen(BlackImage, "WiFi");
            displayConnectToWifiMessage(BlackImage);
            EPD_Display_Partial(BlackImage);
            led_Purple();

            // Attempt to reconnect to WiFi
            WiFiManager wm;
            bool res = wm.autoConnect("TIGERMETER", ""); // password protected ap

            if (!res)
            {
                // If reconnection fails, continue displaying the message
                return;
            }
            else
            {
                // If reconnected, display the main screen
                drawInitialScreen(BlackImage, "BTC");
            }
        }
    }

    // Regular display update
    if (iteration % FULL_UPDATE_INTERVAL == 0)
    {
        drawInitialScreen(BlackImage, "BTC");
    }
    else
    {
        displayDateTime(BlackImage);
        displayRandomNumber(BlackImage);
        displayProfitOrLoss(BlackImage);
        EPD_Display_Partial(BlackImage);
    }
}

void displayDateTime(UBYTE *BlackImage)
{
    time_t now = time(NULL);
    struct tm *current_time = localtime(&now);

    char dateTimeBuffer[30];
    // Changed here: %H for 24-hour format instead of %I for 12-hour format
    strftime(dateTimeBuffer, sizeof(dateTimeBuffer), "%H %M %d %b %Y", current_time);

    const sFONT *fontDate = &Font16;
    Paint_ClearWindows(DATE_TIME_X, DATE_TIME_Y, DATE_TIME_X + fontDate->Width * strlen(dateTimeBuffer), DATE_TIME_Y + fontDate->Height, WHITE);
    Paint_DrawString_EN(DATE_TIME_X, DATE_TIME_Y, dateTimeBuffer, (sFONT *)fontDate, WHITE, BLACK);

    // Blink the ":" symbol
    static bool blink = true;
    if (blink)
    {
        Paint_DrawChar(DATE_TIME_X + fontDate->Width * 2, DATE_TIME_Y, ':', (sFONT *)fontDate, BLACK, WHITE);
    }
    blink = !blink;
}

void displayConnectToWifiMessage(UBYTE *BlackImage)
{
    const sFONT *fontNetwork = &Font24;
    const sFONT *fontIp = &Font8;
    int xNet = 102;
    int yNet = 55;

    Paint_ClearWindows(xNet, yNet, xNet + fontNetwork->Width * 11, yNet + fontNetwork->Height, WHITE);
    Paint_DrawString_EN(xNet, yNet, "tigermeter", (sFONT *)fontNetwork, WHITE, BLACK);

    int xIp = xNet;
    int yIp = DISPLAY_HEIGHT - fontIp->Height;

    Paint_ClearWindows(xIp, yIp, xIp + fontIp->Width * 16, yIp + fontIp->Height, WHITE);
    Paint_DrawString_EN(xIp, yIp, "192.168.4.1", (sFONT *)fontIp, WHITE, BLACK);
}
void displayRandomNumber(UBYTE *BlackImage)
{
    int randomNumber = rand() % 3001 + 58999; // Generate random number between 58999 and 61999 char randomNumberStr[7]; sprintf(randomNumberStr, "$%d", randomNumber);
    char randomNumberStr[7];
    sprintf(randomNumberStr, "$%d", randomNumber);
    const sFONT *fontNums = &Font40;
    int numsX = DATE_TIME_X;
    int numsY = DATE_TIME_Y + 43;
    Paint_ClearWindows(numsX, numsY, numsX + fontNums->Width * 7, numsY + fontNums->Height, WHITE);
    Paint_DrawString_EN(numsX, numsY, randomNumberStr, (sFONT *)fontNums, WHITE, BLACK);
}

void displayProfitOrLoss(UBYTE *BlackImage)
{
    const char *sign = (rand() % 2 == 0) ? "+" : "-";
    float randomPercentage = (rand() % 500 + 1) / 100.0; // Generates a number between 0.01 and 5.00
    char randomPercentageStr[7];                         // Buffer to hold the percentage string
    snprintf(randomPercentageStr, sizeof(randomPercentageStr), "%s%.2f%%", sign, randomPercentage);

    char displayStr[20]; // Buffer to hold the final display string
    snprintf(displayStr, sizeof(displayStr), "1 day %s", randomPercentageStr);

    const sFONT *fontProfit = &Font24;
    int profitX = DATE_TIME_X;
    int profitY = DISPLAY_HEIGHT - fontProfit->Height;

    // Debugging statements
    // Debug("Updating profit/loss display: %s\n", displayStr);

    Paint_ClearWindows(profitX, profitY, profitX + fontProfit->Width * strlen(displayStr), profitY + fontProfit->Height, WHITE);
    Paint_DrawString_EN(profitX, profitY, displayStr, (sFONT *)fontProfit, WHITE, BLACK);

    // Switch LEDs based on sign
    if (strcmp(sign, "+") == 0)
    {
        led_Green();
    }
    else
    {
        led_Red();
    }

    // Play buzzer with 10% chance
    if (rand() % 10 == 0)
    {
        if (strcmp(sign, "+") == 0)
        {
            playBuzzerPositive();
        }
        else
        {
            playBuzzerNegative();
        }
    }
}

void initNTPTime()
{
    // Moscow Time Zone "MSK", UTC offset is +3:00, no daylight saving
    configTime(3 * 3600, 0, "pool.ntp.org", "time.nist.gov");

    Serial.println("\nWaiting for time");
    while (!time(nullptr))
    {
        Serial.print(".");
        delay(1000);
    }
    Serial.println("");

    struct tm timeinfo;
    if (!getLocalTime(&timeinfo))
    {
        Serial.println("Failed to obtain time");
        return;
    }
    Serial.println("Time initialized");
}

#ifdef DEMO_MODE
// Show strongest WiFi network full-screen for 10 seconds
void showStrongestWifi(UBYTE *BlackImage)
{
    // Prepare canvas (with 270° rotation: visual is 384 wide x 168 tall)
    Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);

    // Perform WiFi scan
    Debug("Scanning WiFi networks...\r\n");
    int n = WiFi.scanNetworks();

    // Pick strongest non-empty SSID
    int bestIdx = -1;
    int bestRssi = -1000;
    for (int i = 0; i < n; i++)
    {
        String ssid = WiFi.SSID(i);
        if (ssid.length() == 0) continue;
        int rssi = WiFi.RSSI(i);
        if (rssi > bestRssi)
        {
            bestRssi = rssi;
            bestIdx = i;
        }
    }

    const sFONT *fontTitle = &Font24;
    const sFONT *fontSsid = &Font32;

    // Draw title "WiFi:" at top
    const char *title = "WiFi:";
    int titleX = (VISUAL_WIDTH - fontTitle->Width * strlen(title)) / 2;
    Paint_DrawString_EN(titleX, 20, title, (sFONT *)fontTitle, WHITE, BLACK);

    // Draw SSID centered
    if (bestIdx >= 0)
    {
        String ssid = WiFi.SSID(bestIdx);
        char ssidStr[32];
        snprintf(ssidStr, sizeof(ssidStr), "%.20s", ssid.c_str());
        
        int ssidW = fontSsid->Width * strlen(ssidStr);
        int ssidX = (VISUAL_WIDTH - ssidW) / 2;
        if (ssidX < 0) ssidX = 0;
        int ssidY = (VISUAL_HEIGHT - fontSsid->Height) / 2;
        
        Paint_DrawString_EN(ssidX, ssidY, ssidStr, (sFONT *)fontSsid, WHITE, BLACK);

        // Draw signal strength below
        char rssiStr[16];
        snprintf(rssiStr, sizeof(rssiStr), "%d dBm", bestRssi);
        int rssiW = fontTitle->Width * strlen(rssiStr);
        int rssiX = (VISUAL_WIDTH - rssiW) / 2;
        Paint_DrawString_EN(rssiX, ssidY + fontSsid->Height + 10, rssiStr, (sFONT *)fontTitle, WHITE, BLACK);
    }
    else
    {
        const char *noWifi = "No WiFi found";
        int noWifiW = fontSsid->Width * strlen(noWifi);
        int noWifiX = (VISUAL_WIDTH - noWifiW) / 2;
        int noWifiY = (VISUAL_HEIGHT - fontSsid->Height) / 2;
        Paint_DrawString_EN(noWifiX, noWifiY, noWifi, (sFONT *)fontSsid, WHITE, BLACK);
    }

    // Full refresh
    EPD_Display(BlackImage);

    // Wait 10 seconds
    DEV_Delay_ms(10000);
}

// Draw the demo header: black bar on left with "DEMO" text
void renderDemoHeader(UBYTE *BlackImage)
{
    Paint_NewImage(BlackImage, DISPLAY_WIDTH, DISPLAY_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    drawRectangleAndText("DEMO");
}

// Render the uptime timer in the right area
void renderUptime(UBYTE *BlackImage)
{
    // Compute uptime in hours, minutes, seconds
    unsigned long seconds = millis() / 1000UL;
    unsigned int hh = (seconds / 3600UL) % 100U;
    unsigned int mm = (seconds / 60UL) % 60U;
    unsigned int ss = seconds % 60U;

    char timeStr[9];
    snprintf(timeStr, sizeof(timeStr), "%02u:%02u:%02u", hh, mm, ss);

    const sFONT *font = &Font40;
    
    // Calculate position to center in the right area (after RECT_WIDTH)
    int rightAreaStart = RECT_WIDTH;
    int rightAreaWidth = VISUAL_WIDTH - RECT_WIDTH;
    int textWidth = font->Width * strlen(timeStr);
    int x = rightAreaStart + (rightAreaWidth - textWidth) / 2;
    int y = (VISUAL_HEIGHT - font->Height) / 2;

    // Clear the timer area and draw
    Paint_ClearWindows(rightAreaStart, 0, VISUAL_WIDTH, VISUAL_HEIGHT, WHITE);
    Paint_DrawString_EN(x, y, timeStr, (sFONT *)font, WHITE, BLACK);
}

// Main demo loop: show DEMO bar + timer, update every second
void runDemoLoop(UBYTE *BlackImage)
{
    // Draw initial screen with DEMO bar
    renderDemoHeader(BlackImage);
    renderUptime(BlackImage);

    // Full refresh to establish baseline
    EPD_Display_Base(BlackImage);

    // Loop: update timer every second with partial refresh
    unsigned long lastUpdate = millis();
    unsigned long lastMacPrint = 0;
    const unsigned long MAC_PRINT_INTERVAL = 5000; // Print MAC every 5 seconds
    
    while (1)
    {
        // #region agent log [Hypothesis A]
        Serial.print("."); Serial.flush(); // Tick marker - if stops here, captivePortalLoop hung
        // #endregion
        captivePortalLoop();
        // #region agent log [Hypothesis A]
        Serial.print("c"); Serial.flush(); // After captive portal
        // #endregion
        
        unsigned long now = millis();
        
        // Print debug info every 5 seconds
        if (now - lastMacPrint >= MAC_PRINT_INTERVAL)
        {
            lastMacPrint = now;
            
            // Uptime
            unsigned long uptimeSec = now / 1000;
            unsigned int hh = (uptimeSec / 3600) % 100;
            unsigned int mm = (uptimeSec / 60) % 60;
            unsigned int ss = uptimeSec % 60;
            
            Serial.println("\n===== [DEMO] Debug Info =====");
            Serial.printf("[DEMO] Uptime: %02u:%02u:%02u\r\n", hh, mm, ss);
            Serial.println("[DEMO] MAC: " + WiFi.macAddress());
            Serial.printf("[DEMO] AP IP: %s\r\n", WiFi.softAPIP().toString().c_str());
            // #region agent log [Hypothesis E]
            Serial.printf("[DEMO] Free Heap: %u bytes\r\n", ESP.getFreeHeap()); Serial.flush();
            // #endregion
            Serial.printf("[DEMO] Connected clients: %d\r\n", WiFi.softAPgetStationNum());
            
            // #region agent log [Hypothesis D]
            Serial.print("[DEMO] Reading battery..."); Serial.flush();
            // #endregion
            // Battery voltage on GPIO 35
            int batteryRaw = analogRead(35);
            float batteryVoltage = (batteryRaw / 4095.0) * 3.3;
            Serial.printf(" %.2fV (raw: %d)\r\n", batteryVoltage, batteryRaw);
            Serial.println("=============================");
        }
        
        // Update display every 1000ms, accounting for refresh time
        if (now - lastUpdate >= 1000)
        {
            // #region agent log [Hypothesis B,C]
            Serial.print("R"); Serial.flush(); // Before renderUptime
            // #endregion
            lastUpdate = now;
            renderUptime(BlackImage);
            // #region agent log [Hypothesis B]
            Serial.print("E"); Serial.flush(); // Before EPD_Display_Partial
            // #endregion
            EPD_Display_Partial(BlackImage);
            // #region agent log [Hypothesis B]
            Serial.print("D"); Serial.flush(); // After display update complete
            // #endregion
        }
        
        DEV_Delay_ms(50);  // Small delay to prevent busy loop
    }
}

void ledBlinkTask(void *pvParameters)
{
    (void)pvParameters;
    const uint16_t pulseDuration = 3000; // 3 seconds per color pulse
    for (;;)
    {
        // Cycle through 7 rainbow colors: Red, Orange, Yellow, Green, Cyan, Blue, Violet
        for (int i = 0; i < 7; i++)
        {
            pulseRainbowColor(i, pulseDuration);
        }
    }
}
#endif

#endif // GXEPD2_TEST