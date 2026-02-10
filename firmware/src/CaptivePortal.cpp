#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <Update.h>
#include <stdarg.h>

#include "CaptivePortal.h"
#include "utility/FirmwareUpdate.h"
#include "Display.h"

// Exposed from main.ino
extern const int CURRENT_FIRMWARE_VERSION;

// Module-level variable for unique SSID (generated at runtime from MAC)
String apSsid;

namespace
{
    const IPAddress AP_IP(192, 168, 4, 1);
    const IPAddress AP_NETMASK(255, 255, 255, 0);

    DNSServer dnsServer;
    WebServer server(80);
    Preferences preferences;

    bool portalStarted = false;
    bool otaSuccess = false;

    // Web log buffer (circular, max 30 entries)
    const int LOG_BUFFER_SIZE = 30;
    String logBuffer[LOG_BUFFER_SIZE];
    int logHead = 0;
    int logCount = 0;

    void addWebLog(const String &msg)
    {
        logBuffer[logHead] = String(millis() / 1000) + "s: " + msg;
        logHead = (logHead + 1) % LOG_BUFFER_SIZE;
        if (logCount < LOG_BUFFER_SIZE) logCount++;
    }

    void handleLogs()
    {
        String page;
        page.reserve(4096);
        page += F("<!DOCTYPE html><html><head><meta charset='utf-8'>");
        page += F("<meta name='viewport' content='width=device-width,initial-scale=1'>");
        page += F("<meta http-equiv='refresh' content='3'>");
        page += F("<title>TigerMeter Logs</title>");
        page += F("<style>"
                  "body{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;"
                  "margin:0;padding:20px;background:#0a0a0f;color:#00d4aa;min-height:100vh}"
                  ".wrap{max-width:600px;margin:0 auto}"
                  ".header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"
                  "padding-bottom:12px;border-bottom:1px solid #2a2a3a}"
                  "h1{font-size:16px;font-weight:600;margin:0;color:#f0f0f5}"
                  "a{color:#f0b90b;text-decoration:none;font-size:13px}"
                  "a:hover{text-decoration:underline}"
                  ".log{font-size:12px;line-height:1.8;white-space:pre-wrap;word-break:break-all}"
                  ".empty{color:#666;font-style:italic}"
                  ".ts{color:#666}"
                  "</style></head><body><div class='wrap'>");
        page += F("<div class='header'><h1>Device Logs</h1><a href='/'>&larr; Back</a></div>");
        page += F("<div class='log'>");
        
        // Output logs from oldest to newest
        int start = (logCount < LOG_BUFFER_SIZE) ? 0 : logHead;
        for (int i = 0; i < logCount; i++) {
            int idx = (start + i) % LOG_BUFFER_SIZE;
            page += logBuffer[idx] + "\n";
        }
        if (logCount == 0) {
            page += F("<span class='empty'>No logs yet. Waiting for events...</span>");
        }
        
        page += F("</div></div></body></html>");
        server.send(200, "text/html", page);
    }

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

    // Shared CSS for dark theme pages
    const char* DARK_STYLE = 
        "body{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;"
        "margin:0;padding:20px;background:#0a0a0f;color:#f0f0f5;min-height:100vh;"
        "background-image:radial-gradient(ellipse at 20% 0%,rgba(240,185,11,0.08) 0%,transparent 50%)}"
        ".wrap{max-width:420px;margin:0 auto}"
        "header{text-align:center;margin-bottom:24px}"
        ".logo{width:48px;height:48px;margin-bottom:12px}"
        "h1{font-size:22px;font-weight:600;margin:0;letter-spacing:-0.02em}"
        "h1 span{color:#f0b90b}"
        ".card{background:#1a1a24;border:1px solid #2a2a3a;border-radius:12px;padding:16px;margin-bottom:14px}"
        ".card h2{font-size:14px;font-weight:600;margin:0 0 12px;color:#f0f0f5}"
        ".row{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:6px}"
        ".row:last-child{margin-bottom:0}"
        ".lbl{color:#8888a0}"
        ".val{color:#f0f0f5}"
        ".badge{background:#f0b90b;color:#000;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}"
        ".ok{color:#00d4aa}"
        ".warn{color:#ff6b6b}"
        ".link{color:#f0b90b}"
        "label{display:block;font-size:12px;color:#8888a0;margin:10px 0 4px}"
        "input[type=text],input[type=password]{width:100%;padding:10px;background:#12121a;border:1px solid #2a2a3a;"
        "border-radius:8px;color:#f0f0f5;font-size:14px;box-sizing:border-box;font-family:inherit}"
        "input[type=text]:focus,input[type=password]:focus{border-color:#f0b90b;outline:none}"
        "input[type=file]{font-size:12px;color:#8888a0;margin:8px 0}"
        "input[type=file]::file-selector-button{background:#2a2a3a;color:#f0f0f5;border:none;padding:8px 12px;"
        "border-radius:6px;font-size:12px;cursor:pointer;margin-right:10px}"
        "button,input[type=submit]{width:100%;background:linear-gradient(135deg,#f0b90b 0%,#d4a00a 100%);"
        "color:#000;font-weight:600;border:none;border-radius:8px;padding:12px;font-size:14px;cursor:pointer;"
        "margin-top:12px;font-family:inherit;transition:opacity .2s}"
        "button:hover,input[type=submit]:hover{opacity:0.9}"
        "button:disabled,input[type=submit]:disabled{background:#3a3a4a;color:#666;cursor:default}"
        ".btn-danger{background:linear-gradient(135deg,#ff4444 0%,#cc3333 100%);color:#fff}"
        ".hint{font-size:11px;color:#666;margin-top:8px}";

    // Binance logo SVG
    const char* BINANCE_LOGO_IMG = 
        "<svg class='logo' viewBox='0 0 126.61 126.61'><g fill='#f3ba2f'>"
        "<path d='m38.73 53.2 24.59-24.58 24.6 24.6 14.3-14.31-38.9-38.91-38.9 38.9z'/>"
        "<path d='m0 63.31 14.3-14.31 14.31 14.31-14.31 14.3z'/>"
        "<path d='m38.73 73.41 24.59 24.59 24.6-24.6 14.31 14.29-38.9 38.91-38.91-38.88z'/>"
        "<path d='m98 63.31 14.3-14.31 14.31 14.3-14.31 14.32z'/>"
        "<path d='m77.83 63.3-14.51-14.52-10.73 10.73-1.24 1.23-2.54 2.54 14.51 14.5 14.51-14.47z'/>"
        "</g></svg>";

    void handleRoot()
    {
        String page;
        page.reserve(4096);

        page += F("<!DOCTYPE html><html><head><meta charset='utf-8'>");
        page += F("<meta name='viewport' content='width=device-width,initial-scale=1'>");
        page += F("<title>TigerMeter</title>");
        page += F("<style>");
        page += DARK_STYLE;
        page += F("</style></head><body><div class='wrap'>");

        // Header with logo
        page += F("<header>");
        page += BINANCE_LOGO_IMG;
        page += F("<h1>Tiger<span>Meter</span></h1>");
        page += F("</header>");

        // Device status card
        page += F("<div class='card'><h2>Device</h2>");
        page += F("<div class='row'><span class='lbl'>Firmware</span><span class='badge'>v");
        page += String(CURRENT_FIRMWARE_VERSION);
        page += F("</span></div>");
        page += F("<div class='row'><span class='lbl'>Wi-Fi</span><span class='val'>");
        if (WiFi.status() == WL_CONNECTED) {
            page += htmlEscape(WiFi.SSID());
        } else {
            page += F("<span class='warn'>Not connected</span>");
        }
        page += F("</span></div>");
        if (WiFi.status() == WL_CONNECTED) {
            page += F("<div class='row'><span class='lbl'>IP</span><span class='val'>");
            page += WiFi.localIP().toString();
            page += F("</span></div>");
        }
        page += F("<div class='row'><span class='lbl'>Logs</span><a href='/logs' class='link'>View &rarr;</a></div>");
        page += F("</div>");

        // OTA Update card
        page += F("<div class='card'><h2>Firmware Update</h2>");
        page += F("<div class='row'><span class='lbl'>Current</span><span class='val'>v");
        page += String(CURRENT_FIRMWARE_VERSION);
        page += F("</span></div>");
        
        if (OtaUpdate::getLatestVersion() > 0) {
            page += F("<div class='row'><span class='lbl'>Latest</span><span class='val'>v");
            page += String(OtaUpdate::getLatestVersion());
            if (OtaUpdate::isUpdateAvailable()) {
                page += F(" <span class='ok'>&bull; new</span>");
            } else {
                page += F(" <span class='ok'>&check;</span>");
            }
            page += F("</span></div>");
        }
        
        page += F("<div class='row'><span class='lbl'>Auto-update</span><span class='val'>");
        page += OtaUpdate::autoUpdateEnabled ? "On" : "Off";
        page += F("</span></div>");
        
        if (WiFi.status() == WL_CONNECTED && OtaUpdate::isUpdateAvailable()) {
            page += F("<form method='POST' action='/force-update'>"
                      "<input type='submit' value='Update to v");
            page += String(OtaUpdate::getLatestVersion());
            page += F("' onclick=\"return confirm('Update firmware? Device will reboot.')\">"
                      "</form>");
        } else if (WiFi.status() != WL_CONNECTED) {
            page += F("<div class='hint'>Connect Wi-Fi to check for updates</div>");
        }
        page += F("</div>");

        // WiFi configuration card
        page += F("<div class='card'><h2>Wi-Fi Setup</h2>"
                  "<form method='POST' action='/wifi'>"
                  "<label>Network name (SSID)</label>"
                  "<input name='ssid' type='text' autocomplete='off' required>"
                  "<label>Password</label>"
                  "<input name='password' type='password' autocomplete='off'>"
                  "<input type='submit' value='Connect'>"
                  "</form></div>");

        // Manual OTA upload card
        page += F("<div class='card'><h2>Manual Update</h2>"
                  "<form method='POST' action='/update' enctype='multipart/form-data'>"
                  "<label>Firmware file (.bin)</label>"
                  "<input name='firmware' type='file' accept='.bin' required>"
                  "<input type='submit' value='Upload &amp; Install'>"
                  "</form></div>");

        // Demo mode card
        page += F("<div class='card'><h2>Demo Mode</h2>"
                  "<div class='hint' style='margin-top:0;margin-bottom:8px'>"
                  "Show demo screen with rainbow LED animation</div>"
                  "<form method='POST' action='/demo-mode'>"
                  "<input type='submit' value='");
        page += preferences.getBool("demoMode", false) ? "Disable Demo Mode" : "Enable Demo Mode";
        page += F("'></form></div>");

        // Factory reset card
        page += F("<div class='card'><h2>Factory Reset</h2>"
                  "<div class='hint' style='color:#ff6b6b;margin-top:0;margin-bottom:8px'>"
                  "Erases all data. Device must be reclaimed.</div>"
                  "<form method='POST' action='/reset'>"
                  "<input type='submit' value='Reset Device' class='btn-danger' "
                  "onclick=\"return confirm('Erase all data? This cannot be undone.')\">"
                  "</form></div>");

        page += F("</div></body></html>");

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
        page.reserve(1024);
        page += F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                  "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                  "<title>Wi-Fi</title>"
                  "<style>"
                  "body{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;"
                  "margin:0;padding:20px;background:#0a0a0f;color:#f0f0f5;min-height:100vh;"
                  "display:flex;align-items:center;justify-content:center}"
                  ".box{background:#1a1a24;border:1px solid #2a2a3a;border-radius:12px;padding:24px;"
                  "max-width:360px;text-align:center}"
                  ".icon{font-size:32px;margin-bottom:12px}"
                  "h1{font-size:18px;margin:0 0 8px}"
                  "p{font-size:13px;color:#8888a0;margin:0 0 16px}"
                  ".ok{color:#00d4aa}"
                  ".warn{color:#ff6b6b}"
                  "a{display:inline-block;color:#f0b90b;font-size:13px}"
                  "</style></head><body><div class='box'>");
        
        if (WiFi.status() == WL_CONNECTED) {
            page += F("<div class='icon ok'>&#10003;</div><h1>Connected</h1><p>");
        } else {
            page += F("<div class='icon warn'>!</div><h1>Saved</h1><p>");
        }
        page += htmlEscape(msg);
        page += F("</p><a href='/'>&larr; Back to portal</a></div></body></html>");

        server.send(200, "text/html", page);
    }

    void handleUpdateUpload()
    {
        HTTPUpload &upload = server.upload();

        if (upload.status == UPLOAD_FILE_START)
        {
            Serial.printf("[OTA] START: filename=%s, totalSize=%u\n", upload.filename.c_str(), upload.totalSize);
            otaSuccess = false;
            // Use UPDATE_SIZE_UNKNOWN when totalSize is 0 (not yet known at start)
            size_t updateSize = (upload.totalSize > 0) ? upload.totalSize : UPDATE_SIZE_UNKNOWN;
            if (!Update.begin(updateSize))
            {
                Serial.printf("[OTA] Update.begin FAILED (size=%u)\n", updateSize);
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
                    Serial.printf("[OTA] Write mismatch: expected=%u, written=%u\n", upload.currentSize, written);
                    Update.printError(Serial);
                }
            }
        }
        else if (upload.status == UPLOAD_FILE_END)
        {
            if (Update.end(true))
            {
                Serial.println("[OTA] SUCCESS");
                otaSuccess = true;
            }
            else
            {
                Serial.println("[OTA] FAILED");
                Update.printError(Serial);
            }
        }
        else if (upload.status == UPLOAD_FILE_ABORTED)
        {
            Serial.println("[OTA] ABORTED");
            Update.end();
        }
    }

    // Shared result page style
    const char* RESULT_STYLE = 
        "<style>"
        "body{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;"
        "margin:0;padding:20px;background:#0a0a0f;color:#f0f0f5;min-height:100vh;"
        "display:flex;align-items:center;justify-content:center}"
        ".box{background:#1a1a24;border:1px solid #2a2a3a;border-radius:12px;padding:24px;"
        "max-width:360px;text-align:center}"
        ".icon{font-size:32px;margin-bottom:12px}"
        "h1{font-size:18px;margin:0 0 8px}"
        "p{font-size:13px;color:#8888a0;margin:0 0 16px}"
        ".ok{color:#00d4aa}"
        ".warn{color:#ff6b6b}"
        "a{display:inline-block;color:#f0b90b;font-size:13px}"
        "@keyframes spin{to{transform:rotate(360deg)}}"
        ".spin{animation:spin 1s linear infinite;display:inline-block}"
        "</style>";

    void handleUpdateResult()
    {
        if (Update.hasError() || !otaSuccess)
        {
            String page = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                            "<title>Update Failed</title>");
            page += RESULT_STYLE;
            page += F("</head><body><div class='box'>"
                      "<div class='icon warn'>&#10007;</div>"
                      "<h1>Update Failed</h1>"
                            "<p>Please check the firmware file and try again.</p>"
                      "<a href='/'>&larr; Back to portal</a>"
                      "</div></body></html>");
            server.send(500, "text/html", page);
        }
        else
        {
            String page = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                            "<title>Update Complete</title>");
            page += RESULT_STYLE;
            page += F("</head><body><div class='box'>"
                      "<div class='icon ok'>&#10003;</div>"
                      "<h1>Update Complete</h1>"
                      "<p>Device is rebooting...</p>"
                      "</div></body></html>");
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

    void handleFactoryReset()
    {
        // Clear all stored data in the "tigermeter" namespace
        preferences.clear();
        
        String page = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                        "<title>Factory Reset</title>");
        page += RESULT_STYLE;
        page += F("</head><body><div class='box'>"
                  "<div class='icon ok'>&#10003;</div>"
                  "<h1>Reset Complete</h1>"
                  "<p>All data erased. Device is rebooting...</p>"
                  "</div></body></html>");
        server.send(200, "text/html", page);
        delay(1000);
        ESP.restart();
    }

    void handleDemoMode()
    {
        bool currentMode = preferences.getBool("demoMode", false);
        bool newMode = !currentMode;
        preferences.putBool("demoMode", newMode);
        
        String page = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                        "<title>Demo Mode</title>");
        page += RESULT_STYLE;
        page += F("</head><body><div class='box'>"
                  "<div class='icon ok'>&#10003;</div>"
                  "<h1>Demo Mode ");
        page += newMode ? "Enabled" : "Disabled";
        page += F("</h1>"
                  "<p>Device is rebooting...</p>"
                  "</div></body></html>");
        server.send(200, "text/html", page);
        delay(1000);
        ESP.restart();
    }

    void handleForceUpdate()
    {
        if (WiFi.status() != WL_CONNECTED) {
            String page = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                            "<title>Update Failed</title>");
            page += RESULT_STYLE;
            page += F("</head><body><div class='box'>"
                      "<div class='icon warn'>&#10007;</div>"
                      "<h1>No Connection</h1>"
                      "<p>Connect to Wi-Fi first to download updates.</p>"
                      "<a href='/'>&larr; Back to portal</a>"
                      "</div></body></html>");
            server.send(400, "text/html", page);
            return;
        }
        
        if (!OtaUpdate::isUpdateAvailable()) {
            String page = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                            "<title>Up to Date</title>");
            page += RESULT_STYLE;
            page += F("</head><body><div class='box'>"
                      "<div class='icon ok'>&#10003;</div>"
                      "<h1>Up to Date</h1>"
                      "<p>Already running the latest firmware.</p>"
                      "<a href='/'>&larr; Back to portal</a>"
                      "</div></body></html>");
            server.send(200, "text/html", page);
            return;
        }
        
        // Show updating page
        String page = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                        "<title>Updating</title>");
        page += RESULT_STYLE;
        page += F("</head><body><div class='box'>"
                  "<div class='icon spin'>&#8635;</div>"
                  "<h1>Updating to v");
        page += String(OtaUpdate::getLatestVersion());
        page += F("</h1>"
                  "<p>Downloading firmware...<br>Do not power off the device.</p>"
                  "</div></body></html>");
        server.send(200, "text/html", page);
        
        // Show "Updating" on e-ink display
        display.clear();
        display.fillRect(0, 0, 140, 168, true);  // Black rectangle on left
        display.setFont(FONT_SIZE_MEDIUM);
        display.setTextColor(false);  // White text on black
        display.drawText(45, 70, "OTA");
        display.setTextColor(true);   // Black text
        char updateMsg[32];
        snprintf(updateMsg, sizeof(updateMsg), "Updating to v%d", OtaUpdate::getLatestVersion());
        display.drawText(150, 50, updateMsg);
        display.setFont(FONT_SIZE_SMALL);
        display.drawText(150, 85, "Please wait...");
        display.refresh();
        
        // Perform the update
        Serial.println("[Portal] Starting force OTA update...");
        OtaResult result = OtaUpdate::forceUpdate();
        
        if (result.success) {
            Serial.println("[Portal] OTA update successful, rebooting...");
            delay(1000);
            ESP.restart();
        } else {
            Serial.printf("[Portal] OTA update failed: %s\n", result.errorMessage.c_str());
            // Note: Since we already sent the response, we can't send another one
            // The user will need to refresh to see the status
        }
    }
}

void startCaptivePortal()
{
    Serial.println("[CaptivePortal] Starting...");
    
    if (portalStarted)
    {
        Serial.println("[CaptivePortal] Already started, skipping");
        return;
    }
    portalStarted = true;

    preferences.begin("tigermeter", false);

    // #region agent log - Debug: Use ESP.getEfuseMac() - hardware MAC always available
    // ESP32 has MAC burned into eFuse, WiFi APIs return 00:00:00:00:00:00 before fully initialized
    uint64_t efuseMac = ESP.getEfuseMac();
    Serial.printf("[DEBUG] eFuse MAC raw: 0x%llX\n", efuseMac);
    
    // Extract bytes and format as MAC string (eFuse MAC is in reverse byte order)
    uint8_t macBytes[6];
    macBytes[0] = (efuseMac >> 0) & 0xFF;
    macBytes[1] = (efuseMac >> 8) & 0xFF;
    macBytes[2] = (efuseMac >> 16) & 0xFF;
    macBytes[3] = (efuseMac >> 24) & 0xFF;
    macBytes[4] = (efuseMac >> 32) & 0xFF;
    macBytes[5] = (efuseMac >> 40) & 0xFF;
    
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             macBytes[0], macBytes[1], macBytes[2], macBytes[3], macBytes[4], macBytes[5]);
    Serial.printf("[DEBUG] eFuse MAC formatted: '%s'\n", macStr);
    
    // Get last 4 hex chars for suffix (last 2 bytes = 4 hex chars)
    char suffix[5];
    snprintf(suffix, sizeof(suffix), "%02X%02X", macBytes[4], macBytes[5]);
    Serial.printf("[DEBUG] Generated suffix: '%s'\n", suffix);
    // #endregion
    
    // Generate unique SSID and hostname using last 4 chars of hardware MAC (e.g. "tigermeter-54D8")
    apSsid = "tigermeter-" + String(suffix);
    
    // IMPORTANT: setHostname() must be called BEFORE WiFi.mode() to take effect
    WiFi.setHostname(apSsid.c_str());
    Serial.printf("[CaptivePortal] SSID/Hostname: %s\n", apSsid.c_str());
    
    Serial.println("[CaptivePortal] Setting WiFi mode to AP_STA");
    WiFi.mode(WIFI_AP_STA);
    
    WiFi.softAPConfig(AP_IP, AP_IP, AP_NETMASK);
    
    bool apStarted = WiFi.softAP(apSsid.c_str());
    Serial.printf("[CaptivePortal] softAP('%s') = %s\n", apSsid.c_str(), apStarted ? "OK" : "FAILED");
    
    if (apStarted) {
        Serial.printf("[CaptivePortal] AP IP: %s\n", WiFi.softAPIP().toString().c_str());
    }

    autoConnectFromStoredCredentials();

    dnsServer.start(53, "*", AP_IP);
    Serial.println("[CaptivePortal] DNS server started");

    server.on("/", HTTP_GET, handleRoot);
    server.on("/logs", HTTP_GET, handleLogs);
    server.on("/wifi", HTTP_POST, handleWifiSave);
    server.on("/update", HTTP_POST, handleUpdateResult, handleUpdateUpload);
    server.on("/reset", HTTP_POST, handleFactoryReset);
    server.on("/demo-mode", HTTP_POST, handleDemoMode);
    server.on("/force-update", HTTP_POST, handleForceUpdate);
    server.onNotFound(handleNotFound);

    server.begin();
    Serial.println("[CaptivePortal] HTTP server started on port 80");
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

void webLog(const char *format, ...)
{
    char buf[256];
    va_list args;
    va_start(args, format);
    vsnprintf(buf, sizeof(buf), format, args);
    va_end(args);
    
    Serial.println(buf);  // Also print to serial
    addWebLog(String(buf));
}

const String& getApSsid()
{
    return apSsid;
}







