#ifndef FIRMWARE_UPDATE_H
#define FIRMWARE_UPDATE_H

#include <Arduino.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFiClientSecure.h>

// Exposed from main.ino
extern const int CURRENT_FIRMWARE_VERSION;

// Default GitHub Pages URL (can be overridden from API)
#ifndef FIRMWARE_DOWNLOAD_URL
#define FIRMWARE_DOWNLOAD_URL "https://rd1-io.github.io/tigermeter-api/firmware/prod"
#endif

// OTA update result structure
struct OtaResult {
    bool success;
    bool updateAvailable;
    int newVersion;
    String errorMessage;
};

// Global state for OTA
namespace OtaUpdate {
    inline String firmwareBaseUrl = FIRMWARE_DOWNLOAD_URL;
    inline int latestVersion = 0;
    inline bool autoUpdateEnabled = true;
    
    // Set firmware base URL (called from heartbeat response)
    inline void setFirmwareUrl(const String& url) {
        if (url.length() > 0) {
            firmwareBaseUrl = url;
        }
    }
    
    // Set latest version (called from heartbeat response)
    inline void setLatestVersion(int version) {
        latestVersion = version;
    }
    
    // Set auto-update flag (called from heartbeat response)
    inline void setAutoUpdate(bool enabled) {
        autoUpdateEnabled = enabled;
    }
    
    // Check if update is available based on heartbeat info
    inline bool isUpdateAvailable() {
        return latestVersion > CURRENT_FIRMWARE_VERSION;
    }
    
    // Get current firmware version
    inline int getCurrentVersion() {
        return CURRENT_FIRMWARE_VERSION;
    }
    
    // Get latest firmware version
    inline int getLatestVersion() {
        return latestVersion;
    }
    
    // Follow HTTP redirects and get final URL
    inline String followRedirects(const String& url, int maxRedirects = 5) {
        String currentUrl = url;
        
        for (int i = 0; i < maxRedirects; i++) {
            WiFiClientSecure client;
            client.setInsecure(); // Skip certificate validation for GitHub
            
            HTTPClient http;
            http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
            http.begin(client, currentUrl);
            
            int httpCode = http.GET();
            
            if (httpCode == HTTP_CODE_MOVED_PERMANENTLY || 
                httpCode == HTTP_CODE_FOUND || 
                httpCode == HTTP_CODE_SEE_OTHER ||
                httpCode == HTTP_CODE_TEMPORARY_REDIRECT) {
                String newUrl = http.header("Location");
                http.end();
                
                if (newUrl.length() > 0) {
                    Serial.printf("[OTA] Redirect %d -> %s\n", httpCode, newUrl.c_str());
                    currentUrl = newUrl;
                    continue;
                }
            }
            
            http.end();
            break;
        }
        
        return currentUrl;
    }
    
    // Perform OTA update from GitHub releases
    inline OtaResult performUpdate(int targetVersion) {
        OtaResult result = {false, false, targetVersion, ""};
        
        if (WiFi.status() != WL_CONNECTED) {
            result.errorMessage = "WiFi not connected";
            return result;
        }
        
        if (targetVersion <= CURRENT_FIRMWARE_VERSION) {
            result.errorMessage = "Already up to date";
            return result;
        }
        
        result.updateAvailable = true;
        
        // Build firmware URL: {baseUrl}/firmware-ota.bin (single file, always latest)
        String firmwareUrl = firmwareBaseUrl + "/firmware-ota.bin";
        Serial.printf("[OTA] Downloading firmware from: %s\n", firmwareUrl.c_str());
        
        // Follow redirects to get final download URL (GitHub uses redirects)
        String finalUrl = followRedirects(firmwareUrl);
        Serial.printf("[OTA] Final URL: %s\n", finalUrl.c_str());
        
        // Download and apply firmware
        WiFiClientSecure client;
        client.setInsecure(); // Skip certificate validation
        
        HTTPClient http;
        http.begin(client, finalUrl);
        http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
        
        int httpCode = http.GET();
        
        if (httpCode != HTTP_CODE_OK) {
            result.errorMessage = "HTTP error: " + String(httpCode);
            Serial.printf("[OTA] Download failed: %d\n", httpCode);
            http.end();
            return result;
        }
        
        int contentLength = http.getSize();
        Serial.printf("[OTA] Firmware size: %d bytes\n", contentLength);
        
        if (contentLength <= 0) {
            result.errorMessage = "Invalid content length";
            http.end();
            return result;
        }
        
        // Start OTA update
        if (!Update.begin(contentLength)) {
            result.errorMessage = "Not enough space";
            Serial.printf("[OTA] Update.begin failed: %s\n", Update.errorString());
            http.end();
            return result;
        }
        
        Serial.println("[OTA] Starting firmware update...");
        
        // Write firmware in chunks
        WiFiClient* stream = http.getStreamPtr();
        size_t written = Update.writeStream(*stream);
        
        if (written != contentLength) {
            result.errorMessage = "Write incomplete";
            Serial.printf("[OTA] Write failed: %d/%d bytes\n", written, contentLength);
            Update.abort();
            http.end();
            return result;
        }
        
        // Finalize update
        if (!Update.end()) {
            result.errorMessage = String(Update.errorString());
            Serial.printf("[OTA] Update.end failed: %s\n", Update.errorString());
            http.end();
            return result;
        }
        
        http.end();
        
        Serial.println("[OTA] Update successful! Rebooting...");
        result.success = true;
        
        return result;
    }
    
    // Check and perform update if available and autoUpdate is enabled
    inline OtaResult checkAndUpdate() {
        OtaResult result = {false, false, latestVersion, ""};
        
        if (!autoUpdateEnabled) {
            result.errorMessage = "Auto-update disabled";
            return result;
        }
        
        if (!isUpdateAvailable()) {
            result.errorMessage = "No update available";
            return result;
        }
        
        Serial.printf("[OTA] Update available: v%d -> v%d\n", 
                      CURRENT_FIRMWARE_VERSION, latestVersion);
        
        return performUpdate(latestVersion);
    }
    
    // Force update check and apply (ignores autoUpdate setting)
    inline OtaResult forceUpdate() {
        if (!isUpdateAvailable()) {
            OtaResult result = {false, false, latestVersion, "No update available"};
            return result;
        }
        
        return performUpdate(latestVersion);
    }
}

#endif // FIRMWARE_UPDATE_H
