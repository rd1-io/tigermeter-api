#pragma once
#include <Arduino.h>
#include "esp32-hal-ledc.h"
#include "../DEV_Config.h"
void initializePins()
{
    pinMode(RED_PIN, OUTPUT);
    pinMode(BLUE_PIN, OUTPUT);
    pinMode(GREEN_PIN, OUTPUT);
    ledcAttach(BUZZER_PIN, 100000, 12);
}

void playBuzzerPositive()
{
    // return;
    ledcWriteTone(BUZZER_PIN, 600);
    delay(25);
    ledcWrite(BUZZER_PIN, 0);

    ledcWriteTone(BUZZER_PIN, 1400);
    delay(50);
    ledcWrite(BUZZER_PIN, 0);
}

void playBuzzerNegative()
{
    ledcWriteTone(BUZZER_PIN, 1400);
    delay(25);
    ledcWrite(BUZZER_PIN, 0);

    ledcWriteTone(BUZZER_PIN, 600);
    delay(50);
    ledcWrite(BUZZER_PIN, 0);
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
