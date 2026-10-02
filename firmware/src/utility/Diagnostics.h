#pragma once
#include <Arduino.h>
#include <esp_system.h>
#include <esp_attr.h>

// Boot diagnostics reported in every heartbeat (the device has no serial access in the field).
// The current stage is kept in RTC memory, which survives panics, watchdog and software resets
// (not power loss), so after a crash the next boot reports where the previous run stopped.

enum DiagStage : uint32_t {
    STAGE_BOOT = 1,
    STAGE_IDLE,
    STAGE_HB_REQUEST,
    STAGE_HB_READ,
    STAGE_HB_PARSE,
    STAGE_FRAME_DECODE,
    STAGE_FRAME_APPLY,
    STAGE_RENDER,
    STAGE_LED,
    STAGE_OTA,
};

static const uint32_t DIAG_RTC_MAGIC = 0x7165D1A6;
RTC_NOINIT_ATTR static uint32_t rtcDiagMagic;
RTC_NOINIT_ATTR static uint32_t rtcDiagStage;

static uint32_t diagPrevStage = 0;   // stage of the previous run, 0 = unknown (power-on)
static String diagLastError = "";    // last frame-processing problem, reported until the next one
static uint8_t diagFrameBuffers = 0;
static bool diagFrameBuffersPsram = false;
static uint32_t diagLastResponseBytes = 0;

// Screen refresh stats for frames (v39 partial refresh)
static const char* diagLastRefresh = "";   // "full" / "partial" / "skip" (unchanged bitmap)
static uint32_t diagLastRefreshMs = 0;
static uint16_t diagPartialSinceFull = 0;
static uint32_t diagFullRefreshes = 0;
static uint32_t diagPartialRefreshes = 0;
static uint32_t diagSkippedRefreshes = 0;

// LED crossfades (v40): started, finished duration/steps, cut short by a direct write
static uint32_t diagLedFades = 0;
static uint32_t diagLastFadeMs = 0;
static uint16_t diagLastFadeSteps = 0;
static uint32_t diagLedFadeInterrupts = 0;

inline const char* diagStageName(uint32_t s) {
    switch (s) {
        case STAGE_BOOT: return "boot";
        case STAGE_IDLE: return "idle";
        case STAGE_HB_REQUEST: return "hb_request";
        case STAGE_HB_READ: return "hb_read";
        case STAGE_HB_PARSE: return "hb_parse";
        case STAGE_FRAME_DECODE: return "frame_decode";
        case STAGE_FRAME_APPLY: return "frame_apply";
        case STAGE_RENDER: return "render";
        case STAGE_LED: return "led";
        case STAGE_OTA: return "ota";
        default: return "none";
    }
}

inline const char* diagResetReason() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON: return "poweron";
        case ESP_RST_EXT: return "ext";
        case ESP_RST_SW: return "sw";
        case ESP_RST_PANIC: return "panic";
        case ESP_RST_INT_WDT: return "int_wdt";
        case ESP_RST_TASK_WDT: return "task_wdt";
        case ESP_RST_WDT: return "wdt";
        case ESP_RST_DEEPSLEEP: return "deepsleep";
        case ESP_RST_BROWNOUT: return "brownout";
        case ESP_RST_SDIO: return "sdio";
        default: return "unknown";
    }
}

// Call first thing in setup()
inline void diagBegin() {
    diagPrevStage = (rtcDiagMagic == DIAG_RTC_MAGIC) ? rtcDiagStage : 0;
    rtcDiagMagic = DIAG_RTC_MAGIC;
    rtcDiagStage = STAGE_BOOT;
    Serial.printf("[Diag] reset=%s prevStage=%s psram=%d (%u bytes) heap=%u\n",
                  diagResetReason(), diagStageName(diagPrevStage), psramFound() ? 1 : 0,
                  ESP.getPsramSize(), ESP.getFreeHeap());
}

inline void diagStage(DiagStage s) {
    rtcDiagStage = s;
}

inline void diagError(const String& e) {
    diagLastError = e;
    Serial.println("[Diag] " + e);
}
