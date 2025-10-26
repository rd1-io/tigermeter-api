# 1 "/var/folders/zy/0rh58g1x08q6zz6tx_9hyz3w0000gn/T/tmpxzz7xbfi"
#include <Arduino.h>
# 1 "/Users/Pavel_Demidyuk/projects/tigermeter/tiger-cloud-api/firmware/src/main.ino"
const int CURRENT_FIRMWARE_VERSION = 2;

#include <WiFiManager.h>
#include "DEV_Config.h"
#include "EPD.h"
#include "GUI_Paint.h"
#include <stdlib.h>
#include <time.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "utility/FirmwareUpdate.h"
#include "utility/LedColorsAndNoises.h"
#include <WiFi.h>


const int RECT_WIDTH = 90;
const int RECT_HEIGHT = EPD_2IN9_V2_WIDTH;
const int DATE_TIME_X = 102;
const int DATE_TIME_Y = 0;
const int UPDATE_INTERVAL_MS = 1000;
const int FULL_UPDATE_INTERVAL = 20;
const char *firmware_bin_url = "https://github.com/Pavel-Demidyuk/tigermeter_releases/releases/latest";


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


void renderDemoHeader(UBYTE *BlackImage);
void scanAndRenderTopWifi(UBYTE *BlackImage);
void runDemoIteration(UBYTE *BlackImage, int iteration);
void showHelloMessage(UBYTE *BlackImage);
void showHardwareInfo(UBYTE *BlackImage);
void renderUptime(UBYTE *BlackImage, int iteration);
void ledBlinkTask(void *pvParameters);
void partialTestLoop(UBYTE *BlackImage);
void setup();
void loop();
void drawLogoScreen(UBYTE *BlackImage);
void initNTPTime();
#line 52 "/Users/Pavel_Demidyuk/projects/tigermeter/tiger-cloud-api/firmware/src/main.ino"
void setup()
{
#ifdef DEMO_MODE
    Debug("Starting TigerMeter (DEMO)...\r\n");


    initializePins();
    led_Purple();
    playBuzzerPositive();


    initializeEPaper();


    UBYTE *BlackImage;
    UWORD Imagesize = ((EPD_2IN9_V2_WIDTH % 8 == 0) ? (EPD_2IN9_V2_WIDTH / 8) : (EPD_2IN9_V2_WIDTH / 8 + 1)) * EPD_2IN9_V2_HEIGHT;
    if ((BlackImage = (UBYTE *)malloc(Imagesize)) == NULL)
    {
        Debug("Failed to apply for black memory...\r\n");
        while (1)
            ;
    }


    renderDemoHeader(BlackImage);
    EPD_2IN9_V2_Display(BlackImage);


    showHelloMessage(BlackImage);
    showHardwareInfo(BlackImage);


    WiFi.mode(WIFI_STA);
    WiFi.disconnect(true);


    xTaskCreatePinnedToCore(ledBlinkTask, "ledBlink", 2048, NULL, 1, NULL, 1);


#ifdef PARTIAL_TEST
    partialTestLoop(BlackImage);
#else
    int iteration = 0;
    while (1)
    {
        runDemoIteration(BlackImage, iteration++);
    }
#endif
#else

    Debug("Starting TigerMeter...\r\n");


    initializePins();

    led_Purple();
    playBuzzerPositive();


    initializeEPaper();


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



    drawInitialScreen(BlackImage, "WiFi");
    displayConnectToWifiMessage(BlackImage);
    EPD_2IN9_V2_Display_Partial(BlackImage);


    led_Yellow();
    WiFiManager wm;
    bool res = wm.autoConnect("TIGERMETER", "");

    if (!res)
    {
        ESP.restart();
    }
    else
    {
        initNTPTime();

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

    if (iteration % (60000 / UPDATE_INTERVAL_MS) == 0)
    {
        if (WiFi.status() != WL_CONNECTED)
        {

            drawInitialScreen(BlackImage, "WiFi");
            displayConnectToWifiMessage(BlackImage);
            EPD_2IN9_V2_Display_Partial(BlackImage);
            led_Purple();


            WiFiManager wm;
            bool res = wm.autoConnect("TIGERMETER", "");

            if (!res)
            {

                return;
            }
            else
            {

                drawInitialScreen(BlackImage, "BTC");
            }
        }
    }


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

    strftime(dateTimeBuffer, sizeof(dateTimeBuffer), "%H %M %d %b %Y", current_time);

    const sFONT *fontDate = &Font16;
    Paint_ClearWindows(DATE_TIME_X, DATE_TIME_Y, DATE_TIME_X + fontDate->Width * strlen(dateTimeBuffer), DATE_TIME_Y + fontDate->Height, WHITE);
    Paint_DrawString_EN(DATE_TIME_X, DATE_TIME_Y, dateTimeBuffer, (sFONT *)fontDate, WHITE, BLACK);


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
    int randomNumber = rand() % 3001 + 58999;
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
    float randomPercentage = (rand() % 500 + 1) / 100.0;
    char randomPercentageStr[7];
    snprintf(randomPercentageStr, sizeof(randomPercentageStr), "%s%.2f%%", sign, randomPercentage);

    char displayStr[20];
    snprintf(displayStr, sizeof(displayStr), "1 day %s", randomPercentageStr);

    const sFONT *fontProfit = &Font24;
    int profitX = DATE_TIME_X;
    int profitY = EPD_2IN9_V2_WIDTH - fontProfit->Height;




    Paint_ClearWindows(profitX, profitY, profitX + fontProfit->Width * strlen(displayStr), profitY + fontProfit->Height, WHITE);
    Paint_DrawString_EN(profitX, profitY, displayStr, (sFONT *)fontProfit, WHITE, BLACK);


    if (strcmp(sign, "+") == 0)
    {
        led_Green();
    }
    else
    {
        led_Red();
    }


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

    Paint_NewImage(BlackImage, EPD_2IN9_V2_WIDTH, EPD_2IN9_V2_HEIGHT, 270, WHITE);
    Paint_SelectImage(BlackImage);
    Paint_Clear(WHITE);
    drawRectangleAndText("DEMO");
}

void runDemoIteration(UBYTE *BlackImage, int iteration)
{

    renderUptime(BlackImage, iteration);
    DEV_Delay_ms(1000);
}

void scanAndRenderTopWifi(UBYTE *BlackImage)
{

    int n = WiFi.scanNetworks();


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


    const sFONT *font = &Font24;
    int x1 = DATE_TIME_X;
    int y1 = 40;


    Paint_ClearWindows(DATE_TIME_X, 0, EPD_2IN9_V2_WIDTH, EPD_2IN9_V2_HEIGHT, WHITE);

    if (bestIdx >= 0)
    {
        String ssid = WiFi.SSID(bestIdx);
        char line[48];
        snprintf(line, sizeof(line), "%.22s", ssid.c_str());
        Paint_DrawString_EN(x1, y1, line, (sFONT *)font, WHITE, BLACK);
    }


    EPD_2IN9_V2_Display(BlackImage);
}

void showHelloMessage(UBYTE *BlackImage)
{
    const char *msg = "HELLO";
    const sFONT *font = &Font32;

    int textWidth = font->Width * (int)strlen(msg);
    int areaWidth = EPD_2IN9_V2_WIDTH - DATE_TIME_X;
    int x = DATE_TIME_X + (areaWidth - textWidth) / 2;
    if (x < DATE_TIME_X) x = DATE_TIME_X;
    int y = (EPD_2IN9_V2_HEIGHT - font->Height) / 2;
    if (y < 0) y = 0;


    Paint_ClearWindows(DATE_TIME_X, 0, EPD_2IN9_V2_WIDTH, EPD_2IN9_V2_HEIGHT, WHITE);
    Paint_DrawString_EN(x, y, msg, (sFONT *)font, WHITE, BLACK);

    EPD_2IN9_V2_Display(BlackImage);
    DEV_Delay_ms(1500);
}

void showHardwareInfo(UBYTE *BlackImage)
{

    const char *chip = ESP.getChipModel();
    int rev = ESP.getChipRevision();
    int cores = ESP.getChipCores();
    uint32_t cpu = getCpuFrequencyMhz();
    uint32_t flash = ESP.getFlashChipSize();
    String mac = WiFi.macAddress();


    Paint_ClearWindows(DATE_TIME_X, 0, EPD_2IN9_V2_WIDTH, EPD_2IN9_V2_HEIGHT, WHITE);

    const sFONT *font = &Font16;
    int x = DATE_TIME_X;
    int y = 10;
    int lh = font->Height + 2;

    char line[64];
    snprintf(line, sizeof(line), "Chip: %s", chip);
    Paint_DrawString_EN(x, y, line, (sFONT *)font, WHITE, BLACK);
    y += lh;

    snprintf(line, sizeof(line), "Cores:%d Rev:%d CPU:%dMHz", cores, rev, (int)cpu);
    Paint_DrawString_EN(x, y, line, (sFONT *)font, WHITE, BLACK);
    y += lh;

    snprintf(line, sizeof(line), "Flash:%uMB", (unsigned int)(flash / (1024 * 1024)));
    Paint_DrawString_EN(x, y, line, (sFONT *)font, WHITE, BLACK);
    y += lh;

    snprintf(line, sizeof(line), "MAC:%s", mac.c_str());
    Paint_DrawString_EN(x, y, line, (sFONT *)font, WHITE, BLACK);


    EPD_2IN9_V2_Display(BlackImage);
    DEV_Delay_ms(2000);
}

void renderUptime(UBYTE *BlackImage, int iteration)
{

    if (iteration == 0)
    {

        renderDemoHeader(BlackImage);
        EPD_2IN9_V2_Display_Base(BlackImage);
    }


    unsigned long seconds = millis() / 1000UL;
    unsigned int hh = (seconds / 3600UL) % 100U;
    unsigned int mm = (seconds / 60UL) % 60U;
    unsigned int ss = seconds % 60U;


    int areaX = RECT_WIDTH;
    int areaW = EPD_2IN9_V2_WIDTH - areaX;
    int areaY = 60;


    const sFONT *font = &Font40;
    int charW = font->Width;
    int maxChars = areaW / charW;

    char timeStr[9];
    if (maxChars >= 8)
    {
        snprintf(timeStr, sizeof(timeStr), "%02u:%02u:%02u", hh, mm, ss);
    }
    else if (maxChars >= 5)
    {
        snprintf(timeStr, sizeof(timeStr), "%02u:%02u", (hh * 60 + mm) % 100, ss);
    }
    else
    {
        font = &Font32;
        charW = font->Width;
        snprintf(timeStr, sizeof(timeStr), "%02u:%02u", mm, ss);
    }

    int textWidth = charW * (int)strlen(timeStr);
    int areaH = font->Height + 4;
    int x = areaX + (areaW - textWidth) / 2;
    if (x < areaX) x = areaX;
    int y = areaY;


    Paint_ClearWindows(areaX, areaY, areaX + areaW, areaY + areaH, WHITE);
    Paint_DrawString_EN(x, y, timeStr, (sFONT *)font, WHITE, BLACK);
    EPD_2IN9_V2_Display_Partial(BlackImage);
}

void ledBlinkTask(void *pvParameters)
{
    (void)pvParameters;
    for (;;)
    {
        led_Purple(); vTaskDelay(pdMS_TO_TICKS(200));
        led_Red(); vTaskDelay(pdMS_TO_TICKS(200));
        led_Green(); vTaskDelay(pdMS_TO_TICKS(200));
        led_Yellow(); vTaskDelay(pdMS_TO_TICKS(200));
        led_Blue(); vTaskDelay(pdMS_TO_TICKS(200));
    }
}


void partialTestLoop(UBYTE *BlackImage)
{

    renderDemoHeader(BlackImage);
    const sFONT *font = &Font40;
    int areaX = RECT_WIDTH;
    int areaW = EPD_2IN9_V2_WIDTH - areaX;
    int areaY = 100;
    int areaH = font->Height + 4;


    Paint_DrawString_EN(areaX, areaY - 20, "TIME", (sFONT *)&Font16, WHITE, BLACK);

    EPD_2IN9_V2_Display_Base(BlackImage);


    while (1)
    {
        unsigned long seconds = millis() / 1000UL;
        unsigned int mm = (seconds / 60UL) % 100U;
        unsigned int ss = seconds % 60U;
        char buf[6];
        snprintf(buf, sizeof(buf), "%02u:%02u", mm, ss);


        int textW = (int)strlen(buf) * font->Width;
        int x = areaX + (areaW - textW) / 2;
        if (x < areaX) x = areaX;
        int y = areaY;

        Paint_ClearWindows(areaX, areaY, areaX + areaW, areaY + areaH, WHITE);
        Paint_DrawString_EN(x, y, buf, (sFONT *)font, WHITE, BLACK);


        EPD_2IN9_V2_Display_Partial(BlackImage);
        DEV_Delay_ms(1000);
    }
}
#endif