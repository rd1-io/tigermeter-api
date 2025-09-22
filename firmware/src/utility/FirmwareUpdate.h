#include <HTTPClient.h>
#include <Update.h>

void printHeaders(HTTPClient &http)
{
    // Get all header keys
    int headersCount = http.headers();
    if (headersCount == 0)
    {
        printf("No headers received.\n");
        return;
    }

    printf("Received Headers:\n");
    for (int i = 0; i < headersCount; i++)
    {
        String headerName = http.headerName(i);
        String headerValue = http.header(i);
    }
}

void updateFirmware(int currentFirmwareVersion)
{
    HTTPClient http;
    int newVersion = currentFirmwareVersion + 1;
    bool updateAvailable = false;
    String firmwareUrl;
    int maxRedirects = 10; // Maximum number of redirects to follow
    int redirectCount = 0; // Current count of followed redirects

    http.getString();
    firmwareUrl = "https://github.com/Pavel-Demidyuk/tigermeter_releases/releases/download/" + String(newVersion) + "/firmware.bin";

    Serial.println("url1111: ");
    Serial.println("url2222");
    // Serial.println(firmwareUrl);
    // return;
    http.begin(firmwareUrl);
    int httpCode = http.GET();
    Serial.println("code");
    String payload = http.getString();
    delay(500);
    Serial.println(httpCode);
    Serial.println(http.header("Location"));
    return;
}
