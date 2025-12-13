/*****************************************************************************
* | File       :   EPD_GDEY029T71H.h
* | Author     :   Adapted from Waveshare 2.9\" V2 driver
* | Function   :   2.9\" GDEY029T71H e‑paper (384x168, B/W)
* | Info       :
*----------------------------------------------------------------------------
* The init sequence and LUTs are initially based on the Waveshare 2.9\" V2
* panel driver. For best image quality and refresh behavior on the
* GDEY029T71H panel, you may want to tune these according to the official
* Good Display datasheet / reference code.
******************************************************************************/
#ifndef __EPD_GDEY029T71H_H_
#define __EPD_GDEY029T71H_H_

#include "DEV_Config.h"

// Display resolution (GDEY029T71H)
// Note: Controller RAM is organized as portrait (168 sources × 384 gates)
#define EPD_GDEY029T71H_WIDTH 168
#define EPD_GDEY029T71H_HEIGHT 384

void EPD_GDEY029T71H_Init(void);
void EPD_GDEY029T71H_Clear(void);
void EPD_GDEY029T71H_Display(UBYTE *Image);
void EPD_GDEY029T71H_Display_Base(UBYTE *Image);
void EPD_GDEY029T71H_Display_Partial(UBYTE *Image);
void EPD_GDEY029T71H_Sleep(void);

#endif


