#pragma once
#include <Arduino.h>
#include <driver/ledc.h>
#include "../DEV_Config.h"

// LEDC configuration for buzzer (ESP-IDF level for compatibility)
static const ledc_mode_t BUZZER_SPEED_MODE = LEDC_LOW_SPEED_MODE;
static const ledc_timer_t BUZZER_TIMER = LEDC_TIMER_0;
static const ledc_channel_t BUZZER_CHANNEL = LEDC_CHANNEL_0;
static const ledc_timer_bit_t BUZZER_RES = LEDC_TIMER_12_BIT; // 12-bit resolution

// LEDC configuration for RGB LED (using channels 1-3 and timer 1)
static const ledc_mode_t LED_SPEED_MODE = LEDC_LOW_SPEED_MODE;
static const ledc_timer_t LED_TIMER = LEDC_TIMER_1;
static const ledc_channel_t RED_CHANNEL = LEDC_CHANNEL_1;
static const ledc_channel_t GREEN_CHANNEL = LEDC_CHANNEL_2;
static const ledc_channel_t BLUE_CHANNEL = LEDC_CHANNEL_3;
static const ledc_timer_bit_t LED_RES = LEDC_TIMER_8_BIT; // 8-bit resolution (0-255)
static const int LED_FREQ = 5000; // 5kHz PWM frequency
static const int LED_MAX_DUTY = 255; // Max duty for 8-bit resolution

// Current RGB values (0 = full brightness, 255 = off for common anode LED)
static uint8_t currentR = 255;
static uint8_t currentG = 255;
static uint8_t currentB = 255;

// Rainbow colors for common anode LED (target values when fully ON)
// Format: {R_on, G_on, B_on} where 0 = fully on, 255 = off
static const uint8_t RAINBOW_COLORS[7][3] = {
    {0, 255, 255},   // Red
    {0, 180, 255},   // Orange (red + some green)
    {0, 0, 255},     // Yellow (red + green)
    {255, 0, 255},   // Green
    {255, 0, 180},   // Cyan (green + some blue)
    {255, 255, 0},   // Blue
    {0, 255, 0}      // Violet (red + blue)
};
static const int RAINBOW_COLOR_COUNT = 7;

void initializePins()
{
    // Configure LEDC timer for LED PWM
    ledc_timer_config_t led_timer_config = {};
    led_timer_config.speed_mode = LED_SPEED_MODE;
    led_timer_config.duty_resolution = LED_RES;
    led_timer_config.timer_num = LED_TIMER;
    led_timer_config.freq_hz = LED_FREQ;
    led_timer_config.clk_cfg = LEDC_AUTO_CLK;
    ledc_timer_config(&led_timer_config);

    // Configure RED channel
    ledc_channel_config_t red_channel_config = {};
    red_channel_config.gpio_num = RED_PIN;
    red_channel_config.speed_mode = LED_SPEED_MODE;
    red_channel_config.channel = RED_CHANNEL;
    red_channel_config.intr_type = LEDC_INTR_DISABLE;
    red_channel_config.timer_sel = LED_TIMER;
    red_channel_config.duty = LED_MAX_DUTY; // Start off (common anode)
    red_channel_config.hpoint = 0;
    ledc_channel_config(&red_channel_config);

    // Configure GREEN channel
    ledc_channel_config_t green_channel_config = {};
    green_channel_config.gpio_num = GREEN_PIN;
    green_channel_config.speed_mode = LED_SPEED_MODE;
    green_channel_config.channel = GREEN_CHANNEL;
    green_channel_config.intr_type = LEDC_INTR_DISABLE;
    green_channel_config.timer_sel = LED_TIMER;
    green_channel_config.duty = LED_MAX_DUTY; // Start off
    green_channel_config.hpoint = 0;
    ledc_channel_config(&green_channel_config);

    // Configure BLUE channel
    ledc_channel_config_t blue_channel_config = {};
    blue_channel_config.gpio_num = BLUE_PIN;
    blue_channel_config.speed_mode = LED_SPEED_MODE;
    blue_channel_config.channel = BLUE_CHANNEL;
    blue_channel_config.intr_type = LEDC_INTR_DISABLE;
    blue_channel_config.timer_sel = LED_TIMER;
    blue_channel_config.duty = LED_MAX_DUTY; // Start off
    blue_channel_config.hpoint = 0;
    ledc_channel_config(&blue_channel_config);

    // Configure LEDC timer and channel for buzzer
    ledc_timer_config_t timer_config = {};
    timer_config.speed_mode = BUZZER_SPEED_MODE;
    timer_config.duty_resolution = BUZZER_RES;
    timer_config.timer_num = BUZZER_TIMER;
    timer_config.freq_hz = 1000; // initial frequency
    timer_config.clk_cfg = LEDC_AUTO_CLK;
    ledc_timer_config(&timer_config);

    ledc_channel_config_t channel_config = {};
    channel_config.gpio_num = BUZZER_PIN;
    channel_config.speed_mode = BUZZER_SPEED_MODE;
    channel_config.channel = BUZZER_CHANNEL;
    channel_config.intr_type = LEDC_INTR_DISABLE;
    channel_config.timer_sel = BUZZER_TIMER;
    channel_config.duty = 0; // start silent
    channel_config.hpoint = 0;
    ledc_channel_config(&channel_config);
}

// Track if LED channels are stopped
static bool ledChannelsStopped = false;

// Set LED PWM values directly (0 = full brightness, 255 = off for common anode)
void setLedPWM(uint8_t r, uint8_t g, uint8_t b)
{
    // Restart LEDC channels if they were stopped by led_Off()
    if (ledChannelsStopped) {
        ledc_set_duty(LED_SPEED_MODE, RED_CHANNEL, 255);
        ledc_update_duty(LED_SPEED_MODE, RED_CHANNEL);
        ledc_set_duty(LED_SPEED_MODE, GREEN_CHANNEL, 255);
        ledc_update_duty(LED_SPEED_MODE, GREEN_CHANNEL);
        ledc_set_duty(LED_SPEED_MODE, BLUE_CHANNEL, 255);
        ledc_update_duty(LED_SPEED_MODE, BLUE_CHANNEL);
        ledChannelsStopped = false;
    }
    
    currentR = r;
    currentG = g;
    currentB = b;
    ledc_set_duty(LED_SPEED_MODE, RED_CHANNEL, r);
    ledc_update_duty(LED_SPEED_MODE, RED_CHANNEL);
    ledc_set_duty(LED_SPEED_MODE, GREEN_CHANNEL, g);
    ledc_update_duty(LED_SPEED_MODE, GREEN_CHANNEL);
    ledc_set_duty(LED_SPEED_MODE, BLUE_CHANNEL, b);
    ledc_update_duty(LED_SPEED_MODE, BLUE_CHANNEL);
}

// Pulse a single color: off -> on -> off over durationMs
// targetR, targetG, targetB: target values when fully ON (0 = full brightness for common anode)
void pulseColor(uint8_t targetR, uint8_t targetG, uint8_t targetB, uint16_t durationMs)
{
    const int steps = 50; // Steps per half-cycle (fade in or fade out)
    const int stepDelay = durationMs / (steps * 2); // Total duration split between fade in and fade out
    
    // Phase 1: Fade in (255 -> target, i.e. off -> on)
    for (int i = 1; i <= steps; i++)
    {
        // Linear interpolation from OFF (255) to ON (target)
        uint8_t r = 255 - ((255 - targetR) * i) / steps;
        uint8_t g = 255 - ((255 - targetG) * i) / steps;
        uint8_t b = 255 - ((255 - targetB) * i) / steps;
        
        setLedPWM(r, g, b);
        delay(stepDelay);
    }
    
    // Phase 2: Fade out (target -> 255, i.e. on -> off)
    for (int i = 1; i <= steps; i++)
    {
        // Linear interpolation from ON (target) to OFF (255)
        uint8_t r = targetR + ((255 - targetR) * i) / steps;
        uint8_t g = targetG + ((255 - targetG) * i) / steps;
        uint8_t b = targetB + ((255 - targetB) * i) / steps;
        
        setLedPWM(r, g, b);
        delay(stepDelay);
    }
    
    // Ensure LED is fully off at the end
    setLedPWM(255, 255, 255);
}

// Pulse a rainbow color by index (0-6)
void pulseRainbowColor(int colorIndex, uint16_t durationMs)
{
    if (colorIndex < 0 || colorIndex >= RAINBOW_COLOR_COUNT) return;
    pulseColor(
        RAINBOW_COLORS[colorIndex][0],
        RAINBOW_COLORS[colorIndex][1],
        RAINBOW_COLORS[colorIndex][2],
        durationMs
    );
}

void playBuzzerPositive()
{
    // return;
    ledc_set_freq(BUZZER_SPEED_MODE, BUZZER_TIMER, 600);
    ledc_set_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL, 1 << (BUZZER_RES - 1));
    ledc_update_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL);
    delay(25);
    ledc_set_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL, 0);
    ledc_update_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL);

    ledc_set_freq(BUZZER_SPEED_MODE, BUZZER_TIMER, 1400);
    ledc_set_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL, 1 << (BUZZER_RES - 1));
    ledc_update_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL);
    delay(50);
    ledc_set_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL, 0);
    ledc_update_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL);
}

void playBuzzerNegative()
{
    ledc_set_freq(BUZZER_SPEED_MODE, BUZZER_TIMER, 1400);
    ledc_set_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL, 1 << (BUZZER_RES - 1));
    ledc_update_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL);
    delay(25);
    ledc_set_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL, 0);
    ledc_update_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL);

    ledc_set_freq(BUZZER_SPEED_MODE, BUZZER_TIMER, 600);
    ledc_set_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL, 1 << (BUZZER_RES - 1));
    ledc_update_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL);
    delay(50);
    ledc_set_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL, 0);
    ledc_update_duty(BUZZER_SPEED_MODE, BUZZER_CHANNEL);
}

// Current brightness level (0.0 = off, 1.0 = full)
static float currentBrightness = 1.0f;

// Brightness level constants
static const float BRIGHTNESS_OFF = 0.0f;
static const float BRIGHTNESS_LOW = 0.08f;  // Very dim
static const float BRIGHTNESS_MID = 0.25f;  // Moderate
static const float BRIGHTNESS_HIGH = 1.0f;

// Set brightness level from string
void setLedBrightness(const String& brightness) {
    if (brightness == "off") currentBrightness = BRIGHTNESS_OFF;
    else if (brightness == "low") currentBrightness = BRIGHTNESS_LOW;
    else if (brightness == "mid") currentBrightness = BRIGHTNESS_MID;
    else if (brightness == "high") currentBrightness = BRIGHTNESS_HIGH;
    else currentBrightness = BRIGHTNESS_MID; // default
}

// Apply brightness to a single channel value
// For common anode: 0 = full ON, 255 = OFF
// brightness 0.0 = off (return 255), brightness 1.0 = full (return original)
uint8_t applyBrightness(uint8_t channelValue) {
    if (currentBrightness <= 0.0f) return 255; // Off
    if (currentBrightness >= 1.0f) return channelValue; // Full brightness
    
    // For common anode, we need to interpolate between channelValue and 255
    // Lower brightness = closer to 255 (more off)
    int diff = 255 - channelValue; // How much "on" this channel is
    int adjustedDiff = (int)(diff * currentBrightness);
    return 255 - adjustedDiff;
}

// Set LED with current brightness applied
void setLedPWMWithBrightness(uint8_t r, uint8_t g, uint8_t b)
{
    setLedPWM(applyBrightness(r), applyBrightness(g), applyBrightness(b));
}

// Original LED functions using PWM for instant switching (backward compatible)
void led_Purple()
{
    setLedPWMWithBrightness(0, 255, 0); // Red + Blue ON, Green OFF
}

void led_Red()
{
    setLedPWMWithBrightness(0, 255, 255); // Red ON, Green + Blue OFF
}

void led_Green()
{
    setLedPWMWithBrightness(255, 0, 255); // Green ON, Red + Blue OFF
}

void led_Yellow()
{
    setLedPWMWithBrightness(0, 180, 255); // Amber: Red full ON, Green partial, Blue OFF
}

void led_Blue()
{
    setLedPWMWithBrightness(255, 255, 0); // Blue ON, Red + Green OFF
}

void led_Off()
{
    // Stop LEDC channels to fully turn off LED (PWM at 255 still leaks some light)
    ledc_stop(LED_SPEED_MODE, RED_CHANNEL, 1);   // 1 = idle HIGH (off for common anode)
    ledc_stop(LED_SPEED_MODE, GREEN_CHANNEL, 1);
    ledc_stop(LED_SPEED_MODE, BLUE_CHANNEL, 1);
    ledChannelsStopped = true;
    currentR = 255;
    currentG = 255;
    currentB = 255;
}

// Fade in yellow LED from 20% to full brightness over durationMs
// Used during startup logo screen
void fadeInYellow(uint16_t durationMs = 2000)
{
    const int steps = 80;  // 80 steps for 20%->100% range
    const int stepDelay = durationMs / steps;
    
    // Yellow target: R=0 (full on), G=180 (partial), B=255 (off)
    const uint8_t targetR = 0;
    const uint8_t targetG = 180;
    const uint8_t targetB = 255;
    
    // Start at 20% brightness (80% of the way from target to OFF)
    // For common anode: closer to 255 = dimmer
    const uint8_t startR = targetR + (255 - targetR) * 80 / 100;  // 204
    const uint8_t startG = targetG + (255 - targetG) * 80 / 100;  // 240
    const uint8_t startB = targetB;  // Already 255 (off)
    
    // Set initial 20% brightness immediately
    setLedPWM(startR, startG, startB);
    
    // Fade from 20% to 100%
    for (int i = 1; i <= steps; i++)
    {
        uint8_t r = startR - ((startR - targetR) * i) / steps;
        uint8_t g = startG - ((startG - targetG) * i) / steps;
        uint8_t b = startB - ((startB - targetB) * i) / steps;
        
        setLedPWM(r, g, b);
        delay(stepDelay);
    }
    
    // Ensure full yellow at the end
    setLedPWM(targetR, targetG, targetB);
}
