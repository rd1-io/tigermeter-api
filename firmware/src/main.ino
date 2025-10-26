const int CURRENT_FIRMWARE_VERSION = 2;

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

// Constants
const int RECT_WIDTH = 90;
const int RECT_HEIGHT = EPD_2IN9_V2_WIDTH;
const int DATE_TIME_X = 102;
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
void renderDemoHeader(UBYTE *BlackImage);
void scanAndRenderTopWifi(UBYTE *BlackImage);
void runDemoIteration(UBYTE *BlackImage, int iteration);

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
    UWORD Imagesize = ((EPD_2IN9_V2_WIDTH % 8 == 0) ? (EPD_2IN9_V2_WIDTH / 8) : (EPD_2IN9_V2_WIDTH / 8 + 1)) * EPD_2IN9_V2_HEIGHT;
    if ((BlackImage = (UBYTE *)malloc(Imagesize)) == NULL)
    {
        Debug("Failed to apply for black memory...\r\n");
        while (1)
            ;
    }

    // Render demo header once
    renderDemoHeader(BlackImage);
    EPD_2IN9_V2_Display(BlackImage);

    // Prepare WiFi scanning
    WiFi.mode(WIFI_STA);
    WiFi.disconnect(true);

    int iteration = 0;
    while (1)
    {
        runDemoIteration(BlackImage, iteration++);
    }
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
    UWORD Imagesize = ((EPD_2IN9_V2_WIDTH % 8 == 0) ? (EPD_2IN9_V2_WIDTH / 8) : (EPD_2IN9_V2_WIDTH / 8 + 1)) * EPD_2IN9_V2_HEIGHT;
    if ((BlackImage = (UBYTE *)malloc(Imagesize)) == NULL)
    {
        Debug("Failed to apply for black memory...\r\n");
        while (1)
            ;
    }

    drawLogoScreen(BlackImage);
    delay(500);
    // return;

    // Display initial WiFi message
    drawInitialScreen(BlackImage, "WiFi");
    displayConnectToWifiMessage(BlackImage);
    EPD_2IN9_V2_Display_Partial(BlackImage);

    // Attempt to connect to WiFi
    led_Yellow();
    WiFiManager wm;
    bool res = wm.autoConnect("TIGERMETER", ""); // password protected ap

    if (!res)
    {
        ESP.restart();
    }
    else
    {
        initNTPTime();
        // Connected to WiFi, display main screen
        drawInitialScreen(BlackImage, "BTC");
        int iteration = 0;
        while (1)
        {
            updateDisplay(BlackImage, iteration);
            iteration++;
            DEV_Delay_ms(UPDATE_INTERVAL_MS);
        }
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
    EPD_2IN9_V2_Init();
    EPD_2IN9_V2_Clear();
}

void drawLogoScreen(UBYTE *BlackImage)
{
    initializeEPaper();
    Paint_NewImage(BlackImage, EPD_2IN9_V2_WIDTH, EPD_2IN9_V2_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    int textX = 45;
    int textY = 40;
    Paint_DrawString_EN(textX, textY, "TIGERMETER", &Font38, WHITE, BLACK);
    EPD_2IN9_V2_Display(BlackImage);
}

void drawInitialScreen(UBYTE *BlackImage, const char *Text)
{
    initializeEPaper();
    Paint_NewImage(BlackImage, EPD_2IN9_V2_WIDTH, EPD_2IN9_V2_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    drawRectangleAndText(Text);
    // EPD_2IN9_V2_Display(BlackImage);
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
            EPD_2IN9_V2_Display_Partial(BlackImage);
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
        EPD_2IN9_V2_Display_Partial(BlackImage);
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
    Paint_DrawString_EN(xNet, yNet, "TIGERMETER", (sFONT *)fontNetwork, WHITE, BLACK);

    int xIp = xNet;
    int yIp = EPD_2IN9_V2_WIDTH - fontIp->Height;

    Paint_ClearWindows(xIp, yIp, xIp + fontIp->Width * 11, yIp + fontIp->Height, WHITE);
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
    int profitY = EPD_2IN9_V2_WIDTH - fontProfit->Height;

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
void renderDemoHeader(UBYTE *BlackImage)
{
    // Prepare canvas and draw left black bar with DEMO text
    Paint_NewImage(BlackImage, EPD_2IN9_V2_WIDTH, EPD_2IN9_V2_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    drawRectangleAndText("DEMO");
}

void runDemoIteration(UBYTE *BlackImage, int iteration)
{
    // Cycle LEDs
    led_Purple(); DEV_Delay_ms(200);
    led_Red();    DEV_Delay_ms(200);
    led_Green();  DEV_Delay_ms(200);
    led_Yellow(); DEV_Delay_ms(200);
    led_Blue();   DEV_Delay_ms(200);

    // Short positive beep
    playBuzzerPositive();

    // Scan and render WiFi
    scanAndRenderTopWifi(BlackImage);

    // Small pause before next loop
    DEV_Delay_ms(2000);
}

void scanAndRenderTopWifi(UBYTE *BlackImage)
{
    // Perform WiFi scan
    int n = WiFi.scanNetworks();

    // Determine top 3 by RSSI
    int topIdx[3] = {-1, -1, -1};
    int topRssi[3] = {-1000, -1000, -1000};
    for (int i = 0; i < n; i++)
    {
        int rssi = WiFi.RSSI(i);
        if (rssi > topRssi[0])
        {
            topRssi[2] = topRssi[1]; topIdx[2] = topIdx[1];
            topRssi[1] = topRssi[0]; topIdx[1] = topIdx[0];
            topRssi[0] = rssi;       topIdx[0] = i;
        }
        else if (rssi > topRssi[1])
        {
            topRssi[2] = topRssi[1]; topIdx[2] = topIdx[1];
            topRssi[1] = rssi;       topIdx[1] = i;
        }
        else if (rssi > topRssi[2])
        {
            topRssi[2] = rssi;       topIdx[2] = i;
        }
    }

    // Coordinates for list area (right side of the bar)
    const sFONT *font = &Font16;
    int x = DATE_TIME_X;
    int yBase = 10;
    int lineH = font->Height + 2;

    // Clear list area (3 lines)
    Paint_ClearWindows(x, yBase, EPD_2IN9_V2_HEIGHT, yBase + lineH * 3, WHITE);

    // Draw up to 3 entries
    for (int k = 0; k < 3; k++)
    {
        if (topIdx[k] < 0) continue;
        String ssid = WiFi.SSID(topIdx[k]);
        int rssi = topRssi[k];
        char line[64];
        snprintf(line, sizeof(line), "%d) %.20s (%ddBm)", k + 1, ssid.c_str(), rssi);
        Paint_DrawString_EN(x, yBase + k * lineH, line, (sFONT *)font, WHITE, BLACK);
    }

    // Partial refresh to update list
    EPD_2IN9_V2_Display_Partial(BlackImage);
}
#endif