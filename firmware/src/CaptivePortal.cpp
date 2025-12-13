#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <Update.h>

#include "CaptivePortal.h"

// Exposed from main.ino
extern const int CURRENT_FIRMWARE_VERSION;

namespace
{
    const char *AP_SSID = "tigermeter";
    const IPAddress AP_IP(192, 168, 4, 1);
    const IPAddress AP_NETMASK(255, 255, 255, 0);

    DNSServer dnsServer;
    WebServer server(80);
    Preferences preferences;

    bool portalStarted = false;
    bool otaSuccess = false;

    String htmlEscape(const String &s)
    {
        String out;
        out.reserve(s.length() + 16);
        for (size_t i = 0; i < s.length(); ++i)
        {
            char c = s[i];
            switch (c)
            {
            case '&': out += F("&amp;"); break;
            case '<': out += F("&lt;"); break;
            case '>': out += F("&gt;"); break;
            case '"': out += F("&quot;"); break;
            case '\'': out += F("&#39;"); break;
            default: out += c; break;
            }
        }
        return out;
    }

    String wifiStatusLine()
    {
        wl_status_t st = WiFi.status();
        if (st == WL_CONNECTED)
        {
            String s = F("Connected to ");
            s += WiFi.SSID();
            s += F(" (");
            s += WiFi.localIP().toString();
            s += ')';
            return s;
        }
        return F("Not connected");
    }

    void handleRoot()
    {
        String page;
        page.reserve(2048);

        page += F("<!DOCTYPE html><html><head><meta charset='utf-8'>");
        page += F("<meta name='viewport' content='width=device-width,initial-scale=1'>");
        page += F("<title>TigerMeter Portal</title>");
        page += F("<style>"
                  "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
                  "margin:0;padding:16px;background:#f5f5f7;color:#111}"
                  "h1{font-size:24px;margin-bottom:4px}"
                  "h2{font-size:18px;margin-top:24px;margin-bottom:8px}"
                  ".card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;"
                  "box-shadow:0 4px 12px rgba(0,0,0,0.08)}"
                  "label{display:block;font-size:14px;margin:8px 0 4px}"
                  "input[type=text],input[type=password]{width:100%;padding:8px 10px;border-radius:8px;"
                  "border:1px solid #ccc;font-size:14px;box-sizing:border-box}"
                  "input[type=file]{margin:8px 0}"
                  "button,input[type=submit]{background:#111;color:#fff;border:none;border-radius:999px;"
                  "padding:10px 18px;font-size:14px;cursor:pointer;margin-top:8px}"
                  "button:disabled,input[type=submit]:disabled{background:#aaa;cursor:default}"
                  ".status{font-size:14px;color:#555}"
                  ".badge{display:inline-block;border-radius:999px;padding:4px 10px;font-size:11px;"
                  "text-transform:uppercase;letter-spacing:.08em;background:#111;color:#fff}"
                  "</style></head><body>");

        page += F("<h1>TigerMeter</h1>");
        page += F("<div class='status'>Captive portal on <strong>");
        page += AP_SSID;
        page += F("</strong></div>");

        page += F("<div class='card'><h2>Device</h2>");
        page += F("<div>Firmware version: <span class='badge'>v");
        page += String(CURRENT_FIRMWARE_VERSION);
        page += F("</span></div>");
        page += F("<div style='margin-top:6px;'>Wi‑Fi: ");
        page += htmlEscape(wifiStatusLine());
        page += F("</div></div>");

        page += F("<div class='card'><h2>Wi‑Fi configuration</h2>"
                  "<form method='POST' action='/wifi'>"
                  "<label for='ssid'>SSID</label>"
                  "<input id='ssid' name='ssid' type='text' autocomplete='off' required>"
                  "<label for='password'>Password</label>"
                  "<input id='password' name='password' type='password' autocomplete='off'>"
                  "<input type='submit' value='Save & Connect'>"
                  "</form>"
                  "<div style='margin-top:8px;font-size:12px;color:#777'>"
                  "After saving, the device will try to connect while keeping the "
                  "tigermeter hotspot active."
                  "</div></div>");

        page += F("<div class='card'><h2>OTA firmware update</h2>"
                  "<form method='POST' action='/update' enctype='multipart/form-data'>"
                  "<label for='firmware'>Firmware .bin file</label>"
                  "<input id='firmware' name='firmware' type='file' accept='.bin' required>"
                  "<input type='submit' value='Upload & Update'>"
                  "</form>"
                  "<div style='margin-top:8px;font-size:12px;color:#777'>"
                  "Device will reboot automatically after a successful update."
                  "</div></div>");

        page += F("</body></html>");

        server.send(200, "text/html", page);
    }

    void handleWifiSave()
    {
        String ssid = server.arg("ssid");
        String password = server.arg("password");

        ssid.trim();
        password.trim();

        if (ssid.length() == 0)
        {
            server.send(400, "text/plain", "SSID is required");
            return;
        }

        preferences.putString("ssid", ssid);
        preferences.putString("password", password);

        WiFi.begin(ssid.c_str(), password.length() ? password.c_str() : nullptr);

        unsigned long start = millis();
        const unsigned long timeoutMs = 15000;
        while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs)
        {
            delay(250);
        }

        String msg;
        if (WiFi.status() == WL_CONNECTED)
        {
            msg = F("Connected to ");
            msg += ssid;
            msg += F(" (");
            msg += WiFi.localIP().toString();
            msg += F(")");
        }
        else
        {
            msg = F("Saved credentials for ");
            msg += ssid;
            msg += F(" but failed to connect (timeout).");
        }

        String page;
        page.reserve(512);
        page += F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                  "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                  "<title>Wi‑Fi saved</title></head><body>"
                  "<p>");
        page += htmlEscape(msg);
        page += F("</p><p><a href='/'>Back</a></p></body></html>");

        server.send(200, "text/html", page);
    }

    void handleUpdateUpload()
    {
        HTTPUpload &upload = server.upload();

        if (upload.status == UPLOAD_FILE_START)
        {
            otaSuccess = false;
            if (!Update.begin())
            {
                Update.printError(Serial);
            }
        }
        else if (upload.status == UPLOAD_FILE_WRITE)
        {
            if (Update.isRunning())
            {
                size_t written = Update.write(upload.buf, upload.currentSize);
                if (written != upload.currentSize)
                {
                    Update.printError(Serial);
                }
            }
        }
        else if (upload.status == UPLOAD_FILE_END)
        {
            if (Update.end(true))
            {
                otaSuccess = true;
            }
            else
            {
                Update.printError(Serial);
            }
        }
        else if (upload.status == UPLOAD_FILE_ABORTED)
        {
            Update.end();
        }
    }

    void handleUpdateResult()
    {
        if (Update.hasError() || !otaSuccess)
        {
            String page = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                            "<title>Update failed</title></head><body>"
                            "<h1>Update failed</h1>"
                            "<p>Please check the firmware file and try again.</p>"
                            "<p><a href='/'>Back</a></p>"
                            "</body></html>");
            server.send(500, "text/html", page);
        }
        else
        {
            String page = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                            "<title>Update successful</title></head><body>"
                            "<h1>Update successful</h1>"
                            "<p>Device will reboot now.</p>"
                            "</body></html>");
            server.send(200, "text/html", page);
            delay(1000);
            ESP.restart();
        }
    }

    bool isCaptivePortalRequest()
    {
        String host = server.hostHeader();
        if (!host.length())
        {
            return true;
        }
        if (host == F("captive.apple.com") || host.endsWith(F(".local")))
        {
            return true;
        }
        return false;
    }

    void handleNotFound()
    {
        if (isCaptivePortalRequest())
        {
            server.sendHeader("Location", String("http://") + AP_IP.toString() + "/", true);
            server.send(302, "text/plain", "");
        }
        else
        {
            server.send(404, "text/plain", "Not found");
        }
    }

    void autoConnectFromStoredCredentials()
    {
        String ssid = preferences.getString("ssid", "");
        String password = preferences.getString("password", "");
        ssid.trim();
        password.trim();

        if (ssid.length() == 0)
        {
            return;
        }

        WiFi.begin(ssid.c_str(), password.length() ? password.c_str() : nullptr);
    }
}

void startCaptivePortal()
{
    if (portalStarted)
    {
        return;
    }
    portalStarted = true;

    preferences.begin("tigermeter", false);

    WiFi.mode(WIFI_AP_STA);
    WiFi.softAPConfig(AP_IP, AP_IP, AP_NETMASK);
    WiFi.softAP(AP_SSID);

    autoConnectFromStoredCredentials();

    dnsServer.start(53, "*", AP_IP);

    server.on("/", HTTP_GET, handleRoot);
    server.on("/wifi", HTTP_POST, handleWifiSave);
    server.on("/update", HTTP_POST, handleUpdateResult, handleUpdateUpload);
    server.onNotFound(handleNotFound);

    server.begin();
}

void captivePortalLoop()
{
    if (!portalStarted)
    {
        return;
    }

    dnsServer.processNextRequest();
    server.handleClient();
}






