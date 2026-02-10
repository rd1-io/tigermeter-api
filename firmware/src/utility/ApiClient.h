#ifndef API_CLIENT_H
#define API_CLIENT_H

#include <Arduino.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <Preferences.h>
#include "mbedtls/md.h"

// API Configuration - change API_BASE_URL to your computer's IP
#ifndef API_BASE_URL
#define API_BASE_URL "https://tigermeter-api.fly.dev/api"
#endif

#ifndef HMAC_KEY
#define HMAC_KEY "change-me-dev-hmac"
#endif

// Generate FIRMWARE_VERSION string from FW_VERSION number (e.g. 29 -> "v29")
#ifndef FW_VERSION
#define FW_VERSION 0
#endif
#define _STR(x) #x
#define _XSTR(x) _STR(x)
#define FIRMWARE_VERSION "v" _XSTR(FW_VERSION)

// Device states
#ifndef DEVICESTATE_DEFINED
#define DEVICESTATE_DEFINED
enum DeviceState {
    STATE_UNCLAIMED,        // No credentials stored
    STATE_CLAIMING,         // Got claim code, showing on screen
    STATE_WAITING_ATTACH,   // Polling for user to attach
    STATE_ACTIVE,           // Got secret, heartbeat mode
    STATE_ERROR             // Error state
};
#endif

// Claim result structure
struct ClaimResult {
    bool success;
    String code;
    String expiresAt;
    String errorMessage;
    int httpCode;
};

// Poll result structure
struct PollResult {
    bool success;
    bool pending;       // 202 - still waiting
    bool claimed;       // 200 - got secret
    bool expired;       // 410 - claim expired
    bool notFound;      // 404 - already consumed or invalid
    String deviceId;
    String deviceSecret;
    String displayHash;
    String expiresAt;
    String errorMessage;
    int httpCode;
};

// Font size is now an integer (8-40 pixels)
// Legacy enum kept for backward compatibility during transition
#ifndef FONTSIZETYPE_DEFINED
#define FONTSIZETYPE_DEFINED
// Legacy font size enum (deprecated, kept for compatibility)
enum FontSizeType {
    FONT_SMALL,
    FONT_MID,
    FONT_LARGE
};
#endif

// Text alignment enum
#ifndef TEXTALIGNTYPE_DEFINED
#define TEXTALIGNTYPE_DEFINED
enum TextAlignType {
    ALIGN_LEFT,
    ALIGN_CENTER,
    ALIGN_RIGHT
};
#endif

// Heartbeat result structure
struct HeartbeatResult {
    bool success;
    bool hasInstruction;
    bool factoryReset;      // Server requests device to factory reset
    bool demoMode;          // Server requests demo mode
    String displayHash;
    String errorMessage;
    int httpCode;
    
    // OTA update fields
    bool autoUpdate;
    int latestFirmwareVersion;
    String firmwareDownloadUrl;
    
    // Display instruction fields (if hasInstruction)
    String symbol;
    int symbolFontSize;             // Font size in pixels (10-40) for symbol
    String topLine;
    int topLineFontSize;            // Font size in pixels (10-40)
    TextAlignType topLineAlign;
    bool topLineShowDate;
    String mainText;
    int mainTextFontSize;           // Font size in pixels (10-40)
    TextAlignType mainTextAlign;
    String bottomLine;
    int bottomLineFontSize;         // Font size in pixels (10-40)
    TextAlignType bottomLineAlign;
    String ledColor;
    String ledBrightness;
    bool beep;
    int flashCount;
    int refreshInterval;
    float timezoneOffset; // Hours from UTC (can be fractional like 5.5 for India)
};

// NVS storage keys
const char* NVS_NAMESPACE = "tigermeter";
const char* NVS_DEVICE_ID = "deviceId";
const char* NVS_DEVICE_SECRET = "deviceSecret";
const char* NVS_DISPLAY_HASH = "displayHash";

class ApiClient {
private:
    String _baseUrl;
    String _hmacKey;
    String _firmwareVersion;
    Preferences _prefs;
    
    // Stored credentials
    String _deviceId;
    String _deviceSecret;
    String _displayHash;
    String _currentClaimCode;
    
    // Get device MAC address
    String getMacAddress() {
        uint8_t mac[6];
        WiFi.macAddress(mac);
        char macStr[18];
        snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
        return String(macStr);
    }
    
    // Generate HMAC-SHA256
    String generateHmac(const String& mac, const String& firmwareVersion, unsigned long timestamp) {
        String payload = mac + ":" + firmwareVersion + ":" + String(timestamp);
        
        uint8_t hmacResult[32];
        mbedtls_md_context_t ctx;
        mbedtls_md_init(&ctx);
        mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
        mbedtls_md_hmac_starts(&ctx, (const unsigned char*)_hmacKey.c_str(), _hmacKey.length());
        mbedtls_md_hmac_update(&ctx, (const unsigned char*)payload.c_str(), payload.length());
        mbedtls_md_hmac_finish(&ctx, hmacResult);
        mbedtls_md_free(&ctx);
        
        char hexStr[65];
        for (int i = 0; i < 32; i++) {
            sprintf(hexStr + (i * 2), "%02x", hmacResult[i]);
        }
        hexStr[64] = '\0';
        
        return String(hexStr);
    }
    
public:
    ApiClient(const char* baseUrl = API_BASE_URL, 
              const char* hmacKey = HMAC_KEY,
              const char* firmwareVersion = FIRMWARE_VERSION) 
        : _baseUrl(baseUrl), _hmacKey(hmacKey), _firmwareVersion(firmwareVersion) {}
    
    // Initialize and load stored credentials
    void begin() {
        _prefs.begin(NVS_NAMESPACE, false);
        _deviceId = _prefs.getString(NVS_DEVICE_ID, "");
        _deviceSecret = _prefs.getString(NVS_DEVICE_SECRET, "");
        _displayHash = _prefs.getString(NVS_DISPLAY_HASH, "");
        
        Serial.println("[ApiClient] Initialized");
        Serial.println("[ApiClient] Base URL: " + _baseUrl);
        Serial.println("[ApiClient] MAC: " + getMacAddress());
        if (_deviceId.length() > 0) {
            Serial.println("[ApiClient] Stored deviceId: " + _deviceId);
        }
    }
    
    // Check if device has stored credentials
    bool hasCredentials() {
        return _deviceId.length() > 0 && _deviceSecret.length() > 0;
    }
    
    // Get current device state
    DeviceState getState() {
        if (hasCredentials()) {
            return STATE_ACTIVE;
        }
        if (_currentClaimCode.length() > 0) {
            return STATE_WAITING_ATTACH;
        }
        return STATE_UNCLAIMED;
    }
    
    // Get current claim code (for display)
    String getClaimCode() {
        return _currentClaimCode;
    }
    
    // Get stored device ID
    String getDeviceId() {
        return _deviceId;
    }
    
    // Get current display hash
    String getDisplayHash() {
        return _displayHash;
    }
    
    // Clear stored credentials (for revoke/reset)
    void clearCredentials() {
        _deviceId = "";
        _deviceSecret = "";
        _displayHash = "";
        _currentClaimCode = "";
        _prefs.remove(NVS_DEVICE_ID);
        _prefs.remove(NVS_DEVICE_SECRET);
        _prefs.remove(NVS_DISPLAY_HASH);
        Serial.println("[ApiClient] Credentials cleared");
    }
    
    // Issue a new claim code
    ClaimResult issueClaim() {
        ClaimResult result = {false, "", "", "", 0};
        
        if (WiFi.status() != WL_CONNECTED) {
            result.errorMessage = "WiFi not connected";
            return result;
        }
        
        HTTPClient http;
        String url = _baseUrl + "/device-claims";
        
        Serial.println("[ApiClient] POST " + url);
        
        http.begin(url);
        http.addHeader("Content-Type", "application/json");
        
        String mac = getMacAddress();
        unsigned long timestamp = millis(); // In real app, use NTP time
        String hmac = generateHmac(mac, _firmwareVersion, timestamp);
        
        JsonDocument doc;
        doc["mac"] = mac;
        doc["firmwareVersion"] = _firmwareVersion;
        doc["timestamp"] = timestamp;
        doc["hmac"] = hmac;
        
        String body;
        serializeJson(doc, body);
        
        Serial.println("[ApiClient] Request body: " + body);
        
        int httpCode = http.POST(body);
        result.httpCode = httpCode;
        
        if (httpCode == 201) {
            String response = http.getString();
            Serial.println("[ApiClient] Response: " + response);
            
            JsonDocument respDoc;
            DeserializationError error = deserializeJson(respDoc, response);
            
            if (!error) {
                result.success = true;
                result.code = respDoc["code"].as<String>();
                result.expiresAt = respDoc["expiresAt"].as<String>();
                _currentClaimCode = result.code;
                Serial.println("[ApiClient] Got claim code: " + result.code);
            } else {
                result.errorMessage = "JSON parse error";
            }
        } else {
            String response = http.getString();
            Serial.println("[ApiClient] Error " + String(httpCode) + ": " + response);
            
            JsonDocument respDoc;
            if (deserializeJson(respDoc, response) == DeserializationError::Ok) {
                result.errorMessage = respDoc["message"].as<String>();
            } else {
                result.errorMessage = "HTTP " + String(httpCode);
            }
        }
        
        http.end();
        return result;
    }
    
    // Poll claim status
    PollResult pollClaim() {
        PollResult result = {false, false, false, false, false, "", "", "", "", "", 0};
        
        if (_currentClaimCode.length() == 0) {
            result.errorMessage = "No claim code";
            return result;
        }
        
        if (WiFi.status() != WL_CONNECTED) {
            result.errorMessage = "WiFi not connected";
            return result;
        }
        
        HTTPClient http;
        String url = _baseUrl + "/device-claims/" + _currentClaimCode + "/poll";
        
        Serial.println("[ApiClient] GET " + url);
        
        http.begin(url);
        int httpCode = http.GET();
        result.httpCode = httpCode;
        
        String response = http.getString();
        Serial.println("[ApiClient] Response " + String(httpCode) + ": " + response);
        
        if (httpCode == 200) {
            // Success - got secret
            JsonDocument doc;
            if (deserializeJson(doc, response) == DeserializationError::Ok) {
                result.success = true;
                result.claimed = true;
                result.deviceId = doc["deviceId"].as<String>();
                result.deviceSecret = doc["deviceSecret"].as<String>();
                result.displayHash = doc["displayHash"].as<String>();
                result.expiresAt = doc["expiresAt"].as<String>();
                
                // Store credentials
                _deviceId = result.deviceId;
                _deviceSecret = result.deviceSecret;
                _displayHash = result.displayHash;
                _currentClaimCode = "";
                
                _prefs.putString(NVS_DEVICE_ID, _deviceId);
                _prefs.putString(NVS_DEVICE_SECRET, _deviceSecret);
                _prefs.putString(NVS_DISPLAY_HASH, _displayHash);
                
                Serial.println("[ApiClient] Secret received and stored!");
            }
        } else if (httpCode == 202) {
            // Pending - still waiting for user
            result.success = true;
            result.pending = true;
        } else if (httpCode == 410) {
            // Expired
            result.expired = true;
            result.errorMessage = "Claim expired";
            _currentClaimCode = "";
        } else if (httpCode == 404) {
            // Not found or already consumed
            result.notFound = true;
            result.errorMessage = "Claim not found or already used";
            _currentClaimCode = "";
        } else {
            JsonDocument doc;
            if (deserializeJson(doc, response) == DeserializationError::Ok) {
                result.errorMessage = doc["message"].as<String>();
            } else {
                result.errorMessage = "HTTP " + String(httpCode);
            }
        }
        
        http.end();
        return result;
    }
    
    // Helper to parse font size - handles both numeric and legacy string values
    int parseFontSize(JsonVariant value, int defaultSize = 16) {
        if (value.is<int>()) {
            // New numeric format (10-40)
            int size = value.as<int>();
            if (size < 10) size = 10;
            if (size > 40) size = 40;
            return size;
        } else if (value.is<const char*>()) {
            // Legacy string format
            String size = value.as<String>();
            if (size == "mid") return 20;
            if (size == "large") return 32;
            return 16; // "small" or default
        }
        return defaultSize;
    }
    
    // Helper to parse text alignment
    TextAlignType parseTextAlign(const String& align) {
        if (align == "left") return ALIGN_LEFT;
        if (align == "right") return ALIGN_RIGHT;
        return ALIGN_CENTER;
    }
    
    // Send heartbeat
    // forceRefresh: if true, sends empty displayHash to force server to return instruction
    HeartbeatResult sendHeartbeat(int battery = -1, int rssi = -1, int uptimeSeconds = -1, bool forceRefresh = false) {
        HeartbeatResult result;
        result.success = false;
        result.hasInstruction = false;
        result.factoryReset = false;
        result.demoMode = false;
        result.displayHash = "";
        result.errorMessage = "";
        result.httpCode = 0;
        // OTA fields defaults
        result.autoUpdate = true;
        result.latestFirmwareVersion = 0;
        result.firmwareDownloadUrl = "";
        // Display fields
        result.symbol = "";
        result.symbolFontSize = 24;   // Default 24px for symbol
        result.topLine = "";
        result.topLineFontSize = 16;  // Default 16px
        result.topLineAlign = ALIGN_CENTER;
        result.topLineShowDate = false;
        result.mainText = "";
        result.mainTextFontSize = 32; // Default 32px
        result.mainTextAlign = ALIGN_CENTER;
        result.bottomLine = "";
        result.bottomLineFontSize = 16; // Default 16px
        result.bottomLineAlign = ALIGN_CENTER;
        result.ledColor = "green";
        result.ledBrightness = "mid";
        result.beep = false;
        result.flashCount = 0;
        result.refreshInterval = 30;
        result.timezoneOffset = 3.0f; // Default Moscow UTC+3
        
        if (!hasCredentials()) {
            result.errorMessage = "No credentials";
            return result;
        }
        
        if (WiFi.status() != WL_CONNECTED) {
            result.errorMessage = "WiFi not connected";
            return result;
        }
        
        HTTPClient http;
        String url = _baseUrl + "/devices/" + _deviceId + "/heartbeat";
        
        Serial.println("[ApiClient] POST " + url);
        
        http.begin(url);
        http.addHeader("Content-Type", "application/json");
        http.addHeader("Authorization", "Bearer " + _deviceSecret);
        
        JsonDocument doc;
        if (battery >= 0) doc["battery"] = battery;
        if (rssi != 0) doc["rssi"] = rssi;
        doc["ip"] = WiFi.localIP().toString();
        doc["firmwareVersion"] = _firmwareVersion;
        if (uptimeSeconds >= 0) doc["uptimeSeconds"] = uptimeSeconds;
        // Send empty hash on forceRefresh to get instruction even if hash matches
        doc["displayHash"] = forceRefresh ? "" : _displayHash;
        
        String body;
        serializeJson(doc, body);
        
        int httpCode = http.POST(body);
        result.httpCode = httpCode;
        
        String response = http.getString();
        Serial.println("[ApiClient] Response " + String(httpCode) + ": " + response);
        
        if (httpCode == 200) {
            result.success = true;
            
            JsonDocument respDoc;
            if (deserializeJson(respDoc, response) == DeserializationError::Ok) {
                // Check for factory reset command
                if (respDoc.containsKey("factoryReset") && respDoc["factoryReset"].as<bool>()) {
                    result.factoryReset = true;
                    Serial.println("[ApiClient] Factory reset requested by server!");
                    http.end();
                    return result;
                }
                
                // Parse OTA update fields
                if (respDoc.containsKey("autoUpdate")) {
                    result.autoUpdate = respDoc["autoUpdate"].as<bool>();
                }
                if (respDoc.containsKey("demoMode")) {
                    result.demoMode = respDoc["demoMode"].as<bool>();
                }
                if (respDoc.containsKey("latestFirmwareVersion")) {
                    result.latestFirmwareVersion = respDoc["latestFirmwareVersion"].as<int>();
                }
                if (respDoc.containsKey("firmwareDownloadUrl")) {
                    result.firmwareDownloadUrl = respDoc["firmwareDownloadUrl"].as<String>();
                }
                
                if (respDoc.containsKey("instruction")) {
                    result.hasInstruction = true;
                    result.displayHash = respDoc["displayHash"].as<String>();
                    
                    // Update stored hash
                    _displayHash = result.displayHash;
                    _prefs.putString(NVS_DISPLAY_HASH, _displayHash);
                    
                    // Parse instruction fields
                    JsonObject instr = respDoc["instruction"];
                    
                    // Required fields
                    result.symbol = instr["symbol"].as<String>();
                    result.symbolFontSize = parseFontSize(instr["symbolFontSize"], 24);
                    result.mainText = instr["mainText"].as<String>();
                    
                    // Top line
                    result.topLine = instr["topLine"] | "";
                    result.topLineFontSize = parseFontSize(instr["topLineFontSize"], 16);
                    result.topLineAlign = parseTextAlign(instr["topLineAlign"] | "center");
                    result.topLineShowDate = instr["topLineShowDate"] | false;
                    
                    // Main text
                    result.mainTextFontSize = parseFontSize(instr["mainTextFontSize"], 32);
                    result.mainTextAlign = parseTextAlign(instr["mainTextAlign"] | "center");
                    
                    // Bottom line
                    result.bottomLine = instr["bottomLine"] | "";
                    result.bottomLineFontSize = parseFontSize(instr["bottomLineFontSize"], 16);
                    result.bottomLineAlign = parseTextAlign(instr["bottomLineAlign"] | "center");
                    
                    // LED control
                    result.ledColor = instr["ledColor"] | "green";
                    result.ledBrightness = instr["ledBrightness"] | "mid";
                    
                    // One-time actions
                    result.beep = instr["beep"] | false;
                    result.flashCount = instr["flashCount"] | 0;
                    
                    // Device behavior
                    result.refreshInterval = instr["refreshInterval"] | 30;
                    result.timezoneOffset = instr["timezoneOffset"] | 3.0f;
                    
                    Serial.println("[ApiClient] New instruction: " + result.symbol + " - " + result.mainText);
                } else {
                    // No change
                    result.displayHash = _displayHash;
                }
            }
        } else if (httpCode == 401) {
            // Secret expired - need to re-claim
            result.errorMessage = "Unauthorized - secret may be expired";
            clearCredentials();
        } else if (httpCode == 403) {
            // Device revoked by admin - need to re-provision
            result.errorMessage = "Device revoked";
            clearCredentials();
        } else {
            JsonDocument doc;
            if (deserializeJson(doc, response) == DeserializationError::Ok) {
                result.errorMessage = doc["message"].as<String>();
            } else {
                result.errorMessage = "HTTP " + String(httpCode);
            }
        }
        
        http.end();
        return result;
    }
    
    // Set API base URL (for runtime configuration)
    void setBaseUrl(const String& url) {
        _baseUrl = url;
        Serial.println("[ApiClient] Base URL changed to: " + _baseUrl);
    }
};

#endif // API_CLIENT_H
