/*****************************************************************************
 * Display.cpp - E-Paper display implementation using GxEPD2 + U8g2
 *****************************************************************************/
#include "Display.h"

// U8g2 fonts with Cyrillic support are included via U8g2_for_Adafruit_GFX
// Available fonts: https://github.com/olikraus/u8g2/wiki/fntlistall

// Custom Cyrillic fonts (24px, 28px, 32px, 40px with full Latin + Cyrillic support)
#include "fonts/dejavu24_cyrillic.h"
#include "fonts/dejavu28_cyrillic.h"
#include "fonts/dejavu32_cyrillic.h"
#include "fonts/dejavu40_cyrillic.h"

// Global display instance
Display display;

Display::Display()
    : _display(GxEPD2_290_GDEY029T71H(EPD_CS_PIN, EPD_DC_PIN, EPD_RST_PIN, EPD_BUSY_PIN))
    , _spi(HSPI)
    , _currentFontSize(FONT_SIZE_MEDIUM)
    , _currentFontPixelSize(20)
    , _textColorBlack(true)
{
}

void Display::begin()
{
    Serial.println("[Display] Initializing...");
    
    // Initialize custom SPI (HSPI on ESP32)
    _spi.begin(EPD_SCK_PIN, -1, EPD_MOSI_PIN, EPD_CS_PIN);
    _display.epd2.selectSPI(_spi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
    
    // Initialize display with reset
    _display.init(115200, true, 50, false);  // initial=true, reset_duration=50ms, pulldown_rst_mode=false
    _display.setRotation(1);  // Landscape mode
    _display.setTextWrap(false);
    
    // Initialize U8g2 fonts
    _u8g2.begin(_display);
    _u8g2.setFontMode(1);  // Transparent background
    _u8g2.setFontDirection(0);  // Left to right
    
    // Set default font
    setFont(FONT_SIZE_MEDIUM);
    setTextColor(true);
    
    // Do initial full clear to reset any ghosting
    _display.setFullWindow();
    _display.fillScreen(GxEPD_WHITE);
    _display.display(false);  // Full hardware refresh
    
    Serial.printf("[Display] Initialized (%dx%d)\n", _display.width(), _display.height());
}

void Display::clear()
{
    _display.setFullWindow();  // Must set window before drawing
    _display.fillScreen(GxEPD_WHITE);
}

void Display::refresh()
{
    // Full refresh - complete hardware refresh cycle
    // Must call setFullWindow before display for proper full refresh
    _display.setFullWindow();
    _display.display(false);  // false = full refresh mode
}

void Display::refreshPartial()
{
    // Partial refresh - faster but may have some ghosting
    _display.setFullWindow();
    _display.display(true);  // true = partial update mode
}

void Display::clearAndRefresh()
{
    // Force a complete screen clear with full hardware refresh
    _display.setFullWindow();
    _display.fillScreen(GxEPD_WHITE);
    _display.display(false);
    delay(100);
    _display.fillScreen(GxEPD_WHITE);
    _display.display(false);
}

void Display::sleep()
{
    _display.hibernate();
}

void Display::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, bool black)
{
    _display.fillRect(x, y, w, h, black ? GxEPD_BLACK : GxEPD_WHITE);
}

void Display::drawRect(int16_t x, int16_t y, int16_t w, int16_t h, bool black)
{
    _display.drawRect(x, y, w, h, black ? GxEPD_BLACK : GxEPD_WHITE);
}

void Display::setPixel(int16_t x, int16_t y, bool black)
{
    _display.drawPixel(x, y, black ? GxEPD_BLACK : GxEPD_WHITE);
}

void Display::selectU8g2Font(FontSize size)
{
    // Select fonts with Cyrillic support
    // Available cyrillic fonts: https://github.com/olikraus/u8g2/wiki/fntlistall
    // _t_ = transparent, _cyrillic = includes Cyrillic characters
    switch (size) {
        case FONT_SIZE_SMALL:
            // ~16px height, supports Latin + Cyrillic
            _u8g2.setFont(u8g2_font_unifont_t_cyrillic);
            break;
        case FONT_SIZE_MEDIUM:
            // ~20px height, Cyrillic support
            _u8g2.setFont(u8g2_font_10x20_t_cyrillic);
            break;
        case FONT_SIZE_LARGE:
            // DejaVu Sans Bold 32px - large text with Cyrillic support
            _u8g2.setFont(u8g2_font_dejavu32_t_cyrillic);
            break;
        case FONT_SIZE_SYMBOL:
            // DejaVu Sans Bold 24px - for ticker symbol on black background
            // Custom font with full Cyrillic support!
            _u8g2.setFont(u8g2_font_dejavu24_t_cyrillic);
            break;
        default:
            _u8g2.setFont(u8g2_font_unifont_t_cyrillic);
            break;
    }
}

void Display::setFont(FontSize size)
{
    _currentFontSize = size;
    selectU8g2Font(size);
}

void Display::setFontSize(int pixelSize)
{
    _currentFontPixelSize = pixelSize;
    selectU8g2FontByPixelSize(pixelSize);
}

void Display::selectU8g2FontByPixelSize(int pixelSize)
{
    // Select the best font for the requested pixel size
    // Available fonts: 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40
    // Fonts 24, 28, 32, 40 are custom DejaVu with full Cyrillic support
    // Smaller fonts use built-in U8g2 fonts with Cyrillic
    
    if (pixelSize <= 12) {
        // Small
        _u8g2.setFont(u8g2_font_6x12_t_cyrillic);
    } else if (pixelSize <= 14) {
        // Medium-small
        _u8g2.setFont(u8g2_font_6x13_t_cyrillic);
    } else if (pixelSize <= 17) {
        // Standard small - unifont ~16px
        _u8g2.setFont(u8g2_font_unifont_t_cyrillic);
    } else if (pixelSize <= 22) {
        // Medium - 10x20 font ~20px
        _u8g2.setFont(u8g2_font_10x20_t_cyrillic);
    } else if (pixelSize <= 26) {
        // Custom DejaVu 24px with full Cyrillic
        _u8g2.setFont(u8g2_font_dejavu24_t_cyrillic);
    } else if (pixelSize <= 30) {
        // Custom DejaVu 28px with full Cyrillic
        _u8g2.setFont(u8g2_font_dejavu28_t_cyrillic);
    } else if (pixelSize <= 36) {
        // Custom DejaVu 32px with full Cyrillic
        _u8g2.setFont(u8g2_font_dejavu32_t_cyrillic);
    } else {
        // Large - custom DejaVu 40px with full Cyrillic
        _u8g2.setFont(u8g2_font_dejavu40_t_cyrillic);
    }
}

void Display::setTextColor(bool black)
{
    _textColorBlack = black;
    _u8g2.setForegroundColor(black ? GxEPD_BLACK : GxEPD_WHITE);
    _u8g2.setBackgroundColor(black ? GxEPD_WHITE : GxEPD_BLACK);
}

void Display::drawText(int16_t x, int16_t y, const char* text)
{
    // U8g2 uses baseline for Y coordinate, not top
    // Add font ascent to convert from top-left to baseline
    int16_t fontAscent = _u8g2.getFontAscent();
    _u8g2.setCursor(x, y + fontAscent);
    _u8g2.print(text);
}

void Display::drawTextAligned(int16_t x, int16_t y, int16_t areaWidth, const char* text, TextAlign align)
{
    int16_t textW = getTextWidth(text);
    int16_t drawX;
    
    switch (align) {
        case DISPLAY_ALIGN_LEFT:
            drawX = x + 5;  // Small padding
            break;
        case DISPLAY_ALIGN_RIGHT:
            drawX = x + areaWidth - textW - 5;
            break;
        case DISPLAY_ALIGN_CENTER:
        default:
            drawX = x + (areaWidth - textW) / 2;
            break;
    }
    
    drawText(drawX, y, text);
}

int16_t Display::getTextWidth(const char* text)
{
    return _u8g2.getUTF8Width(text);
}

int16_t Display::getFontHeight()
{
    return _u8g2.getFontAscent() - _u8g2.getFontDescent();
}

void Display::drawBitmap(int16_t x, int16_t y, const uint8_t* bitmap, int16_t w, int16_t h, bool rotate180)
{
    // Draw bitmap pixel by pixel
    // Original code used 180° rotation to compensate for bitmap orientation
    for (int16_t dy = 0; dy < h; dy++) {
        for (int16_t dx = 0; dx < w; dx++) {
            int srcX, srcY;
            if (rotate180) {
                // 180° rotation: read from (w-1-dx, h-1-dy)
                srcX = w - 1 - dx;
                srcY = h - 1 - dy;
            } else {
                srcX = dx;
                srcY = dy;
            }
            
            int byteIndex = (srcY * w + srcX) / 8;
            int bitIndex = 7 - (srcX % 8);
            bool isWhite = (bitmap[byteIndex] >> bitIndex) & 1;
            
            // In the bitmap, 1 = white, 0 = black
            if (!isWhite) {
                setPixel(x + dx, y + dy, true);
            }
        }
    }
}

void Display::drawTextGray(int16_t x, int16_t y, const char* text)
{
    // Draw "gray" text using dithering (checkerboard pattern)
    // First draw text in black, then apply dithering mask
    
    // Get text dimensions
    int16_t textW = getTextWidth(text);
    int16_t textH = getFontHeight();
    int16_t fontAscent = _u8g2.getFontAscent();
    
    // Draw text in black first
    bool savedColor = _textColorBlack;
    setTextColor(true);
    _u8g2.setCursor(x, y + fontAscent);
    _u8g2.print(text);
    
    // Apply checkerboard dithering over the text area
    // This creates a gray effect by clearing every other pixel
    for (int16_t dy = 0; dy < textH; dy++) {
        for (int16_t dx = 0; dx < textW; dx++) {
            // Checkerboard pattern: clear pixel if (x+y) is even
            if (((x + dx) + (y + dy)) % 2 == 0) {
                setPixel(x + dx, y + dy, false);  // Set to white
            }
        }
    }
    
    // Restore original color
    setTextColor(savedColor);
}
