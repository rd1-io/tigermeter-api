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
#define API_BASE_URL "https://api-tiger.rd1.io/api/v5"
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

// Display frame buffer size (384x168 1-bit packed = 8064 bytes)
#define DISPLAY_FRAME_SIZE 8064
#define MAX_DISPLAY_FRAMES 8

// Single display frame (decoded bitmap pointer — allocated in PSRAM to save DRAM)
struct DisplayFrame {
    uint8_t* bitmap;             // pointer to DISPLAY_FRAME_SIZE bytes (ps_malloc)
    char ledColor[16];
    char ledBrightness[8];
    uint32_t durationSec;
    bool beep;
    uint8_t flashCount;
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

// Heartbeat result structure (v5: bitmap frames)
struct HeartbeatResult {
    bool success;
    bool hasNewDisplay;     // Server returned new frames
    bool factoryReset;      // Server requests factory reset
    bool demoMode;          // Server requests demo mode
    String displayHash;
    String errorMessage;
    int httpCode;

    // OTA update fields
    bool autoUpdate;
    int latestFirmwareVersion;
    String firmwareDownloadUrl;

    // Frame data (if hasNewDisplay)
    DisplayFrame frames[MAX_DISPLAY_FRAMES];
    uint8_t frameCount;
    uint32_t refreshInterval;
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

    // PSRAM-allocated frame bitmap buffers (shared across heartbeat calls)
    uint8_t* _frameBitmaps[MAX_DISPLAY_FRAMES] = {nullptr};

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

    // Base64 decode table
    static const uint8_t b64_table[128];

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

        // Allocate frame bitmap buffers in PSRAM (saves ~128KB DRAM)
        for (int i = 0; i < MAX_DISPLAY_FRAMES; i++) {
            _frameBitmaps[i] = (uint8_t*)ps_malloc(DISPLAY_FRAME_SIZE);
            if (!_frameBitmaps[i]) {
                Serial.printf("[ApiClient] WARNING: PSRAM alloc failed for frame %d\n", i);
            }
        }

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
        unsigned long timestamp = millis();
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
            JsonDocument doc;
            if (deserializeJson(doc, response) == DeserializationError::Ok) {
                result.success = true;
                result.claimed = true;
                result.deviceId = doc["deviceId"].as<String>();
                result.deviceSecret = doc["deviceSecret"].as<String>();
                result.displayHash = doc["displayHash"].as<String>();
                result.expiresAt = doc["expiresAt"].as<String>();

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
            result.success = true;
            result.pending = true;
        } else if (httpCode == 410) {
            result.expired = true;
            result.errorMessage = "Claim expired";
            _currentClaimCode = "";
        } else if (httpCode == 404) {
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

    // Base64 decode into buffer, returns decoded length. Safely handles invalid input.
    static int base64Decode(const char* input, uint8_t* output, int maxOutputLen) {
        if (!input || !output || maxOutputLen <= 0) return 0;
        int len = strlen(input);
        if (len == 0) return 0;

        int outIdx = 0;
        for (int i = 0; i < len && outIdx < maxOutputLen; i += 4) {
            uint32_t n = 0;
            int pad = 0;
            bool valid = true;
            for (int j = 0; j < 4 && (i + j) < len && valid; j++) {
                uint8_t c = (uint8_t)input[i + j];
                if (c == '=') {
                    pad++;
                    n <<= 6;
                } else if (c < 128 && b64_table[c] < 64) {
                    n = (n << 6) | b64_table[c];
                } else {
                    valid = false;
                }
            }
            if (!valid) break;
            if (outIdx < maxOutputLen) output[outIdx++] = (n >> 16) & 0xFF;
            if (outIdx < maxOutputLen && pad < 2) output[outIdx++] = (n >> 8) & 0xFF;
            if (outIdx < maxOutputLen && pad < 1) output[outIdx++] = n & 0xFF;
        }
        return outIdx;
    }

    // Send heartbeat (v5 frames format)
    HeartbeatResult sendHeartbeat(int battery = -1, int rssi = -1, int uptimeSeconds = -1, bool forceRefresh = false) {
        HeartbeatResult result;
        result.success = false;
        result.hasNewDisplay = false;
        result.factoryReset = false;
        result.demoMode = false;
        result.displayHash = "";
        result.errorMessage = "";
        result.httpCode = 0;
        result.autoUpdate = true;
        result.latestFirmwareVersion = 0;
        result.firmwareDownloadUrl = "";
        result.frameCount = 0;
        result.refreshInterval = 60;

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
                // Factory reset command
                if (respDoc.containsKey("factoryReset") && respDoc["factoryReset"].as<bool>()) {
                    result.factoryReset = true;
                    Serial.println("[ApiClient] Factory reset requested by server!");
                    http.end();
                    return result;
                }

                // OTA fields
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

                // Parse frames array (if present and non-empty)
                if (respDoc.containsKey("frames")) {
                    JsonArray framesArray = respDoc["frames"].as<JsonArray>();
                    int frameCount = framesArray.size();
                    if (frameCount > 0) {
                        result.hasNewDisplay = true;
                        if (respDoc.containsKey("refreshInterval")) {
                            result.refreshInterval = respDoc["refreshInterval"].as<uint32_t>();
                        }
                        if (respDoc.containsKey("displayHash")) {
                            result.displayHash = respDoc["displayHash"].as<String>();
                        }

                        // Cap at MAX_DISPLAY_FRAMES
                        if (frameCount > MAX_DISPLAY_FRAMES) frameCount = MAX_DISPLAY_FRAMES;
                        result.frameCount = frameCount;

                        for (int i = 0; i < frameCount; i++) {
                            JsonObject frame = framesArray[i];
                            DisplayFrame& df = result.frames[i];
                            // Point df.bitmap at our PSRAM buffer
                            df.bitmap = _frameBitmaps[i];

                            // Decode bitmap (must be exactly DISPLAY_FRAME_SIZE bytes)
                            const char* b64 = frame["bitmap"].as<const char*>();
                            if (!df.bitmap) {
                                Serial.printf("[ApiClient] Frame %d: no PSRAM buffer, skipping\n", i);
                                df.durationSec = 0;
                                df.beep = false;
                                df.flashCount = 0;
                                df.ledColor[0] = '\0';
                                df.ledBrightness[0] = '\0';
                                continue;
                            }
                            int decodedLen = base64Decode(b64, df.bitmap, DISPLAY_FRAME_SIZE);
                            if (decodedLen != DISPLAY_FRAME_SIZE) {
                                Serial.printf("[ApiClient] Frame %d: invalid bitmap size %d (expected %d), skipping\n", i, decodedLen, DISPLAY_FRAME_SIZE);
                                memset(df.bitmap, 0, DISPLAY_FRAME_SIZE);
                                df.durationSec = 0;
                                df.beep = false;
                                df.flashCount = 0;
                                df.ledColor[0] = '\0';
                                df.ledBrightness[0] = '\0';
                                continue;
                            }

                            // Copy per-frame fields
                            const char* lc = frame["ledColor"] | "green";
                            const char* lb = frame["ledBrightness"] | "mid";
                            strncpy(df.ledColor, lc, 15);
                            df.ledColor[15] = '\0';
                            strncpy(df.ledBrightness, lb, 7);
                            df.ledBrightness[7] = '\0';
                            df.durationSec = frame["durationSec"] | 30u;
                            df.beep = frame["beep"] | false;
                            df.flashCount = frame["flashCount"] | 0;
                            if (df.flashCount > 10) df.flashCount = 10;
                        }

                        // Update stored hash
                        _displayHash = result.displayHash;
                        _prefs.putString(NVS_DISPLAY_HASH, _displayHash);

                        Serial.printf("[ApiClient] Received %d frames, refreshInterval=%u\n", frameCount, result.refreshInterval);
                    } else {
                        // Empty frames array — "waiting for content"
                        result.hasNewDisplay = false;
                        result.frameCount = 0;
                        if (respDoc.containsKey("refreshInterval")) {
                            result.refreshInterval = respDoc["refreshInterval"].as<uint32_t>();
                        }
                    }
                } else {
                    // No frames key — hash match, no change
                    result.displayHash = _displayHash;
                }
            }
        } else if (httpCode == 401) {
            result.errorMessage = "Unauthorized - secret may be expired";
            clearCredentials();
        } else if (httpCode == 403) {
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

// Base64 decode table (compact, valid chars 0-63, invalid = 64)
const uint8_t ApiClient::b64_table[128] = {
    64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,64,
    64,64,64,64,64,64,64,64,64,64,64,62,64,64,64,63,52,53,54,55,56,57,58,59,60,61,64,64,64,0,64,64,
    64,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,64,64,64,64,64,
    64,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,64,64,64,64,64
};

#endif // API_CLIENT_H