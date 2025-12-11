#ifndef __EPD_H_
#define __EPD_H_

#include "utility/Debug.h"
#include "utility/EPD_GDEY029T71H.h"
// Legacy Waveshare 2.9\" V2 driver is kept for reference but not used
// directly by the main firmware anymore.
// #include "utility/EPD_2in9_V2.h"

// Small convenience aliases so application code can call the generic names
// without caring about the underlying panel model.
// NOTE: We intentionally do *not* alias the width/height macros here; the
// layout code should use its own DISPLAY_WIDTH/HEIGHT constants.
static inline void EPD_Init() { EPD_GDEY029T71H_Init(); }
static inline void EPD_Clear() { EPD_GDEY029T71H_Clear(); }
static inline void EPD_Display(UBYTE *Image) { EPD_GDEY029T71H_Display(Image); }
static inline void EPD_Display_Base(UBYTE *Image) { EPD_GDEY029T71H_Display_Base(Image); }
static inline void EPD_Display_Partial(UBYTE *Image) { EPD_GDEY029T71H_Display_Partial(Image); }
static inline void EPD_Sleep() { EPD_GDEY029T71H_Sleep(); }

#endif
