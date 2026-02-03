/*****************************************************************************
 * Display.h - E-Paper display abstraction using GxEPD2 + U8g2
 * 
 * Provides UTF-8/Cyrillic text support via U8g2 fonts.
 * Replaces the old Paint_* functions with a cleaner API.
 *****************************************************************************/
#ifndef _DISPLAY_H_
#define _DISPLAY_H_

#include <Arduino.h>
#include <GxEPD2_BW.h>
#include <U8g2_for_Adafruit_GFX.h>

// Pin definitions (from DEV_Config.h)
#define EPD_SCK_PIN 33
#define EPD_MOSI_PIN 32
#define EPD_CS_PIN 26
#define EPD_RST_PIN 14
#define EPD_DC_PIN 27
#define EPD_BUSY_PIN 13

// Display dimensions (GDEY029T71H: 384x168)
#define DISPLAY_NATIVE_WIDTH 168
#define DISPLAY_NATIVE_HEIGHT 384

// After rotation 1 (landscape): visual dimensions
#define DISPLAY_WIDTH 384
#define DISPLAY_HEIGHT 168

// Font size enum for Display class (legacy, kept for backward compatibility)
enum FontSize {
    FONT_SIZE_SMALL = 0,   // ~16px
    FONT_SIZE_MEDIUM = 1,  // ~20px
    FONT_SIZE_LARGE = 2,   // ~32px
    FONT_SIZE_SYMBOL = 3   // ~24px - for ticker symbol on black bg
};

// Font size thresholds for selecting appropriate U8g2 font
// Maps pixel sizes to available fonts (8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40)
#define FONT_SIZE_8PX   8
#define FONT_SIZE_10PX  10
#define FONT_SIZE_12PX  12
#define FONT_SIZE_14PX  14
#define FONT_SIZE_16PX  16
#define FONT_SIZE_18PX  18
#define FONT_SIZE_20PX  20
#define FONT_SIZE_24PX  24
#define FONT_SIZE_28PX  28
#define FONT_SIZE_32PX  32
#define FONT_SIZE_36PX  36
#define FONT_SIZE_40PX  40

// Text alignment enum for Display class
// Using different names to avoid conflict with TextAlignType from ApiClient.h
enum DisplayTextAlign {
    DISPLAY_ALIGN_LEFT = 0,
    DISPLAY_ALIGN_CENTER = 1,
    DISPLAY_ALIGN_RIGHT = 2
};

// Alias for backward compatibility
typedef DisplayTextAlign TextAlign;

class Display {
public:
    Display();
    
    // Initialize the display
    void begin();
    
    // Clear the display buffer to white
    void clear();
    
    // Full refresh (slow, no ghosting)
    void refresh();
    
    // Partial refresh (fast, may have ghosting)
    void refreshPartial();
    
    // Force complete screen clear with double refresh
    void clearAndRefresh();
    
    // Put display to sleep mode
    void sleep();
    
    // Drawing primitives
    void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, bool black = true);
    void drawRect(int16_t x, int16_t y, int16_t w, int16_t h, bool black = true);
    void setPixel(int16_t x, int16_t y, bool black = true);
    
    // Text drawing with UTF-8/Cyrillic support
    void setFont(FontSize size);           // Legacy enum-based font selection
    void setFontSize(int pixelSize);       // New numeric font size (8-40px)
    void setTextColor(bool black = true);
    void drawText(int16_t x, int16_t y, const char* text);
    void drawTextGray(int16_t x, int16_t y, const char* text);  // Dithered "gray" text
    void drawTextAligned(int16_t x, int16_t y, int16_t width, const char* text, TextAlign align);
    
    // Get text dimensions (for layout calculations)
    int16_t getTextWidth(const char* text);
    int16_t getFontHeight();
    
    // Draw bitmap (for logos) - rotate180 compensates for bitmap orientation
    void drawBitmap(int16_t x, int16_t y, const uint8_t* bitmap, int16_t w, int16_t h, bool rotate180 = false);
    
    // Accessors
    int16_t width() const { return DISPLAY_WIDTH; }
    int16_t height() const { return DISPLAY_HEIGHT; }
    
    // Direct access if needed
    GxEPD2_BW<GxEPD2_290_GDEY029T71H, GxEPD2_290_GDEY029T71H::HEIGHT>& getGxEPD() { return _display; }
    U8G2_FOR_ADAFRUIT_GFX& getU8g2() { return _u8g2; }

private:
    GxEPD2_BW<GxEPD2_290_GDEY029T71H, GxEPD2_290_GDEY029T71H::HEIGHT> _display;
    U8G2_FOR_ADAFRUIT_GFX _u8g2;
    SPIClass _spi;
    FontSize _currentFontSize;
    int _currentFontPixelSize;  // Current font size in pixels
    bool _textColorBlack;
    
    void selectU8g2Font(FontSize size);
    void selectU8g2FontByPixelSize(int pixelSize);
};

// Global display instance
extern Display display;

#endif // _DISPLAY_H_
