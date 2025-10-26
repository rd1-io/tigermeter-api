#pragma once
#include <Arduino.h>
#include <driver/ledc.h>
#include "../DEV_Config.h"
// LEDC configuration for buzzer (ESP-IDF level for compatibility)
static const ledc_mode_t BUZZER_SPEED_MODE = LEDC_LOW_SPEED_MODE;
static const ledc_timer_t BUZZER_TIMER = LEDC_TIMER_0;
static const ledc_channel_t BUZZER_CHANNEL = LEDC_CHANNEL_0;
static const ledc_timer_bit_t BUZZER_RES = LEDC_TIMER_12_BIT; // 12-bit resolution
void initializePins()
{
    pinMode(RED_PIN, OUTPUT);
    pinMode(BLUE_PIN, OUTPUT);
    pinMode(GREEN_PIN, OUTPUT);
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

void led_Purple()
{
    digitalWrite(RED_PIN, LOW);
    digitalWrite(BLUE_PIN, LOW);
    digitalWrite(GREEN_PIN, HIGH);
}

void led_Red()
{
    digitalWrite(RED_PIN, LOW);
    digitalWrite(BLUE_PIN, HIGH);
    digitalWrite(GREEN_PIN, HIGH);
}

void led_Green()
{
    digitalWrite(RED_PIN, HIGH);
    digitalWrite(BLUE_PIN, HIGH);
    digitalWrite(GREEN_PIN, LOW);
}

void led_Yellow()
{
    digitalWrite(RED_PIN, HIGH);
    digitalWrite(BLUE_PIN, LOW);
    digitalWrite(GREEN_PIN, LOW);
}

void led_Blue()
{
    digitalWrite(RED_PIN, HIGH);
    digitalWrite(BLUE_PIN, LOW);
    digitalWrite(GREEN_PIN, HIGH);
}
