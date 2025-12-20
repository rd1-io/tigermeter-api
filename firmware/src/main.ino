// Global firmware version, shared with CaptivePortal.cpp
extern const int CURRENT_FIRMWARE_VERSION = 2;

#ifdef GXEPD2_TEST
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
    int textX = (RECT_WIDTH - Font32.Width * strlen(Text)) / 2;
    int textY = (RECT_HEIGHT - Font32.Height) / 2 - 2;
    Paint_DrawString_EN(textX, textY, Text, &Font32, BLACK, WHITE);
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
    while (1)
    {
        captivePortalLoop();
        
        // Update every 1000ms, accounting for refresh time
        unsigned long now = millis();
        if (now - lastUpdate >= 1000)
        {
            lastUpdate = now;
            renderUptime(BlackImage);
            EPD_Display_Partial(BlackImage);
        }
        
        DEV_Delay_ms(50);  // Small delay to prevent busy loop
    }
}

void ledBlinkTask(void *pvParameters)
{
    (void)pvParameters;
    for (;;)
    {
        led_Purple(); vTaskDelay(pdMS_TO_TICKS(200));
        led_Red();    vTaskDelay(pdMS_TO_TICKS(200));
        led_Green();  vTaskDelay(pdMS_TO_TICKS(200));
        led_Yellow(); vTaskDelay(pdMS_TO_TICKS(200));
        led_Blue();   vTaskDelay(pdMS_TO_TICKS(200));
    }
}
#endif

#endif // GXEPD2_TEST