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
#define API_BASE_URL "http://192.168.1.100:3001/api"
#endif

#ifndef HMAC_KEY
#define HMAC_KEY "change-me-dev-hmac"
#endif

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "1.0.0"
#endif

// Device states
enum DeviceState {
    STATE_UNCLAIMED,        // No credentials stored
    STATE_CLAIMING,         // Got claim code, showing on screen
    STATE_WAITING_ATTACH,   // Polling for user to attach
    STATE_ACTIVE,           // Got secret, heartbeat mode
    STATE_ERROR             // Error state
};

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

// Heartbeat result structure
struct HeartbeatResult {
    bool success;
    bool hasInstruction;
    String displayHash;
    String errorMessage;
    int httpCode;
    // Display instruction fields (if hasInstruction)
    String instructionType;  // "single" or "playlist"
    String name;
    float price;
    String currencySymbol;
    String ledColor;
    float portfolioValue;
    float portfolioChangePercent;
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
    
    // Send heartbeat
    HeartbeatResult sendHeartbeat(int battery = -1, int rssi = -1, int uptimeSeconds = -1) {
        HeartbeatResult result = {false, false, "", "", 0, "", "", 0.0f, "", "", 0.0f, 0.0f};
        
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
        doc["displayHash"] = _displayHash;
        
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
                if (respDoc.containsKey("instruction")) {
                    result.hasInstruction = true;
                    result.displayHash = respDoc["displayHash"].as<String>();
                    
                    // Update stored hash
                    _displayHash = result.displayHash;
                    _prefs.putString(NVS_DISPLAY_HASH, _displayHash);
                    
                    // Parse instruction
                    JsonObject instruction = respDoc["instruction"];
                    result.instructionType = instruction["type"].as<String>();
                    
                    if (result.instructionType == "single" && instruction.containsKey("single")) {
                        JsonObject single = instruction["single"];
                        result.name = single["name"].as<String>();
                        result.price = single["price"].as<float>();
                        result.currencySymbol = single["currencySymbol"].as<String>();
                        result.ledColor = single["ledColor"].as<String>();
                        result.portfolioValue = single["portfolioValue"].as<float>();
                        result.portfolioChangePercent = single["portfolioChangePercent"].as<float>();
                        
                        Serial.println("[ApiClient] New instruction: " + result.name + " " + 
                                     result.currencySymbol + String(result.price, 2));
                    }
                } else {
                    // No change
                    result.displayHash = _displayHash;
                }
            }
        } else if (httpCode == 401) {
            // Secret expired or revoked - need to re-claim
            result.errorMessage = "Unauthorized - secret may be expired";
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
