/*****************************************************************************
* | File       :   EPD_GDEY029T71H.cpp
* | Author     :   Adapted from Waveshare 2.9\" V2 driver
* | Function   :   2.9\" GDEY029T71H e‑paper (384x168, B/W)
* | Info       :
*----------------------------------------------------------------------------
* NOTE: The waveform/LUT data and init sequence are copied from the 2.9\" V2
* Waveshare panel as a reasonable starting point. For production use on the
* GDEY029T71H (384x168, SSD1685‑series controller), you should verify and
* tune these values against the Good Display reference code / datasheet.
******************************************************************************/

#include "EPD_GDEY029T71H.h"
#include "Debug.h"

// Frame buffer size for 384x168, 1bpp
#define EPD_GDEY029T71H_BUF_SIZE ((EPD_GDEY029T71H_WIDTH / 8) * EPD_GDEY029T71H_HEIGHT) // 8064 bytes

// Partial refresh LUT (copied from 2.9\" V2 panel; may need tuning)

// Size is inferred from the initializer to avoid mismatches.
static UBYTE _WF_PARTIAL_GDEY029T71H[] =
	{
		0x0,
		0x40,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x80,
		0x80,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x40,
		0x40,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x80,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0A,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x2,
		0x1,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x1,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x0,
		0x22,
		0x22,
		0x22,
		0x22,
		0x22,
		0x22,
		0x0,
		0x0,
		0x0,
		0x22,
		0x17,
		0x41,
		0xB0,
		0x32,
		0x36,
};

// Full update LUT (copied from 2.9\" V2 panel; may need tuning)
// Size is inferred from the initializer to avoid mismatches.
static UBYTE WS_GDEY029T71H[] =
	{
		0x80, 0x66, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x40, 0x0, 0x0, 0x0,
		0x10, 0x66, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x20, 0x0, 0x0, 0x0,
		0x80, 0x66, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x40, 0x0, 0x0, 0x0,
		0x10, 0x66, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x20, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x14, 0x8, 0x0, 0x0, 0x0, 0x0, 0x1,
		0xA, 0xA, 0x0, 0xA, 0xA, 0x0, 0x1,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x14, 0x8, 0x0, 0x1, 0x0, 0x0, 0x1,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x1,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x0, 0x0, 0x0,
		0x22, 0x17, 0x41, 0x0, 0x32, 0x36};

/******************************************************************************
function :	Software reset
parameter:
******************************************************************************/
static void EPD_GDEY029T71H_Reset(void)
{
	DEV_Digital_Write(EPD_RST_PIN, 1);
	DEV_Delay_ms(10);
	DEV_Digital_Write(EPD_RST_PIN, 0);
	DEV_Delay_ms(2);
	DEV_Digital_Write(EPD_RST_PIN, 1);
	DEV_Delay_ms(10);
}

/******************************************************************************
function :	send command
parameter:
	 Reg : Command register
******************************************************************************/
static void EPD_GDEY029T71H_SendCommand(UBYTE Reg)
{
	DEV_Digital_Write(EPD_DC_PIN, 0);
	DEV_Digital_Write(EPD_CS_PIN, 0);
	DEV_SPI_WriteByte(Reg);
	DEV_Digital_Write(EPD_CS_PIN, 1);
}

/******************************************************************************
function :	Reverse bits in a byte (MSB <-> LSB)
******************************************************************************/
static UBYTE reverseBits(UBYTE b)
{
	b = (b & 0xF0) >> 4 | (b & 0x0F) << 4;
	b = (b & 0xCC) >> 2 | (b & 0x33) << 2;
	b = (b & 0xAA) >> 1 | (b & 0x55) << 1;
	return b;
}

/******************************************************************************
function :	send data
parameter:
	Data : Write data
******************************************************************************/
static void EPD_GDEY029T71H_SendData(UBYTE Data)
{
	DEV_Digital_Write(EPD_DC_PIN, 1);
	DEV_Digital_Write(EPD_CS_PIN, 0);
	DEV_SPI_WriteByte(Data);
	DEV_Digital_Write(EPD_CS_PIN, 1);
}

// Send image data with bit reversal (for displays with LSB-first pixel order)
static void EPD_GDEY029T71H_SendImageData(UBYTE Data)
{
	DEV_Digital_Write(EPD_DC_PIN, 1);
	DEV_Digital_Write(EPD_CS_PIN, 0);
	DEV_SPI_WriteByte(reverseBits(Data));
	DEV_Digital_Write(EPD_CS_PIN, 1);
}

/******************************************************************************
function :	Wait until the busy_pin goes LOW
parameter:
******************************************************************************/
static void EPD_GDEY029T71H_ReadBusy(void)
{
	// Debug("e-Paper busy\r\n");
	while (1)
	{ //=1 BUSY
		if (DEV_Digital_Read(EPD_BUSY_PIN) == 0)
			break;
		DEV_Delay_ms(50);
	}
	DEV_Delay_ms(50);
	// Debug("e-Paper busy release\r\n");
}

static void EPD_GDEY029T71H_LUT(UBYTE *lut)
{
	UBYTE count;
	EPD_GDEY029T71H_SendCommand(0x32);
	for (count = 0; count < 153; count++)
		EPD_GDEY029T71H_SendData(lut[count]);
	EPD_GDEY029T71H_ReadBusy();
}

static void EPD_GDEY029T71H_LUT_by_host(UBYTE *lut)
{
	EPD_GDEY029T71H_LUT((UBYTE *)lut); // lut
	EPD_GDEY029T71H_SendCommand(0x3f);
	EPD_GDEY029T71H_SendData(*(lut + 153));
	EPD_GDEY029T71H_SendCommand(0x03); // gate voltage
	EPD_GDEY029T71H_SendData(*(lut + 154));
	EPD_GDEY029T71H_SendCommand(0x04);		// source voltage
	EPD_GDEY029T71H_SendData(*(lut + 155)); // VSH
	EPD_GDEY029T71H_SendData(*(lut + 156)); // VSH2
	EPD_GDEY029T71H_SendData(*(lut + 157)); // VSL
	EPD_GDEY029T71H_SendCommand(0x2c);		// VCOM
	EPD_GDEY029T71H_SendData(*(lut + 158));
}

/******************************************************************************
function :	Turn On Display
parameter:
******************************************************************************/
static void EPD_GDEY029T71H_TurnOnDisplay(void)
{
	EPD_GDEY029T71H_SendCommand(0x22); // Display Update Control
	EPD_GDEY029T71H_SendData(0xF4);    // From manufacturer example
	EPD_GDEY029T71H_SendCommand(0x20); // Activate Display Update Sequence
	EPD_GDEY029T71H_ReadBusy();
}

static void EPD_GDEY029T71H_TurnOnDisplay_Partial(void)
{
	EPD_GDEY029T71H_SendCommand(0x3C); // BorderWaveform
	EPD_GDEY029T71H_SendData(0xC0);

	EPD_GDEY029T71H_SendCommand(0x22); // Display Update Control
	EPD_GDEY029T71H_SendData(0xDF);    // From manufacturer partial update
	EPD_GDEY029T71H_SendCommand(0x20); // Activate Display Update Sequence
	EPD_GDEY029T71H_ReadBusy();
}

/******************************************************************************
function :	Setting the display window
parameter:
******************************************************************************/
static void EPD_GDEY029T71H_SetWindows(UWORD Xstart, UWORD Ystart, UWORD Xend, UWORD Yend)
{
	EPD_GDEY029T71H_SendCommand(0x44); // SET_RAM_X_ADDRESS_START_END_POSITION
	EPD_GDEY029T71H_SendData((Xstart >> 3) & 0xFF);
	EPD_GDEY029T71H_SendData((Xend >> 3) & 0xFF);

	EPD_GDEY029T71H_SendCommand(0x45); // SET_RAM_Y_ADDRESS_START_END_POSITION
	EPD_GDEY029T71H_SendData(Ystart & 0xFF);
	EPD_GDEY029T71H_SendData((Ystart >> 8) & 0xFF);
	EPD_GDEY029T71H_SendData(Yend & 0xFF);
	EPD_GDEY029T71H_SendData((Yend >> 8) & 0xFF);
}

/******************************************************************************
function :	Set Cursor
parameter:
******************************************************************************/
static void EPD_GDEY029T71H_SetCursor(UWORD Xstart, UWORD Ystart)
{
	EPD_GDEY029T71H_SendCommand(0x4E); // SET_RAM_X_ADDRESS_COUNTER
	EPD_GDEY029T71H_SendData(Xstart & 0xFF);  // X is already byte address

	EPD_GDEY029T71H_SendCommand(0x4F); // SET_RAM_Y_ADDRESS_COUNTER
	EPD_GDEY029T71H_SendData(Ystart & 0xFF);
	EPD_GDEY029T71H_SendData((Ystart >> 8) & 0xFF);
}

/******************************************************************************
function :	Initialize the e-Paper register (from manufacturer example)
parameter:
******************************************************************************/
void EPD_GDEY029T71H_Init(void)
{
	EPD_GDEY029T71H_Reset();

	EPD_GDEY029T71H_ReadBusy();
	EPD_GDEY029T71H_SendCommand(0x12); // SWRESET
	EPD_GDEY029T71H_ReadBusy();

	EPD_GDEY029T71H_SendCommand(0x3C); // BorderWaveform
	EPD_GDEY029T71H_SendData(0x01);

	// Driver output control: gate count = HEIGHT-1 = 383 = 0x017F
	EPD_GDEY029T71H_SendCommand(0x01);
	EPD_GDEY029T71H_SendData((EPD_GDEY029T71H_HEIGHT - 1) & 0xFF);   // 0x7F
	EPD_GDEY029T71H_SendData((EPD_GDEY029T71H_HEIGHT - 1) >> 8);     // 0x01
	EPD_GDEY029T71H_SendData(0x00);

	EPD_GDEY029T71H_SendCommand(0x11); // Data entry mode
	EPD_GDEY029T71H_SendData(0x00);    // X dec, Y dec (mirrored horizontally)

	// Set RAM X address start/end (X decrements from WIDTH/8-1 to 0)
	EPD_GDEY029T71H_SendCommand(0x44);
	EPD_GDEY029T71H_SendData(EPD_GDEY029T71H_WIDTH / 8 - 1);  // Start X = 20
	EPD_GDEY029T71H_SendData(0x00);                           // End X = 0

	// Set RAM Y address start/end (Y decrements from HEIGHT-1 to 0)
	EPD_GDEY029T71H_SendCommand(0x45);
	EPD_GDEY029T71H_SendData((EPD_GDEY029T71H_HEIGHT - 1) & 0xFF);   // Start Y low
	EPD_GDEY029T71H_SendData((EPD_GDEY029T71H_HEIGHT - 1) >> 8);     // Start Y high
	EPD_GDEY029T71H_SendData(0x00);  // End Y low
	EPD_GDEY029T71H_SendData(0x00);  // End Y high

	EPD_GDEY029T71H_SendCommand(0x3C); // BorderWaveform
	EPD_GDEY029T71H_SendData(0x05);

	EPD_GDEY029T71H_SendCommand(0x18); // Read built-in temperature sensor
	EPD_GDEY029T71H_SendData(0x80);

	// Set RAM X counter to WIDTH/8-1
	EPD_GDEY029T71H_SendCommand(0x4E);
	EPD_GDEY029T71H_SendData(EPD_GDEY029T71H_WIDTH / 8 - 1);

	// Set RAM Y counter to HEIGHT-1
	EPD_GDEY029T71H_SendCommand(0x4F);
	EPD_GDEY029T71H_SendData((EPD_GDEY029T71H_HEIGHT - 1) & 0xFF);
	EPD_GDEY029T71H_SendData((EPD_GDEY029T71H_HEIGHT - 1) >> 8);

	EPD_GDEY029T71H_ReadBusy();
}

/******************************************************************************
function :	Clear screen
parameter:
******************************************************************************/
void EPD_GDEY029T71H_Clear(void)
{
	UWORD i;

	EPD_GDEY029T71H_SendCommand(0x24); // write RAM for black(0)/white (1)
	for (i = 0; i < EPD_GDEY029T71H_BUF_SIZE; i++)
	{
		EPD_GDEY029T71H_SendData(0xff);
	}

	EPD_GDEY029T71H_SendCommand(0x26); // write second RAM with 0x00
	for (i = 0; i < EPD_GDEY029T71H_BUF_SIZE; i++)
	{
		EPD_GDEY029T71H_SendData(0x00);
	}
	EPD_GDEY029T71H_TurnOnDisplay();
}

/******************************************************************************
function :	Sends the image buffer in RAM to e-Paper and displays
parameter:
******************************************************************************/
void EPD_GDEY029T71H_Display(UBYTE *Image)
{
	UWORD i;
	EPD_GDEY029T71H_SendCommand(0x24); // write RAM for black(0)/white (1)
	for (i = 0; i < EPD_GDEY029T71H_BUF_SIZE; i++)
	{
		EPD_GDEY029T71H_SendData(Image[i]);
	}
	EPD_GDEY029T71H_SendCommand(0x26); // write second RAM
	for (i = 0; i < EPD_GDEY029T71H_BUF_SIZE; i++)
	{
		EPD_GDEY029T71H_SendData(0x00);
	}
	EPD_GDEY029T71H_TurnOnDisplay();
}

void EPD_GDEY029T71H_Display_Base(UBYTE *Image)
{
	UWORD i;

	// Write image to RAM
	EPD_GDEY029T71H_SendCommand(0x24);
	for (i = 0; i < EPD_GDEY029T71H_BUF_SIZE; i++)
	{
		EPD_GDEY029T71H_SendData(Image[i]);
	}
	// Write 0x00 to second RAM
	EPD_GDEY029T71H_SendCommand(0x26);
	for (i = 0; i < EPD_GDEY029T71H_BUF_SIZE; i++)
	{
		EPD_GDEY029T71H_SendData(0x00);
	}
	EPD_GDEY029T71H_TurnOnDisplay();

	// For partial refresh base: also copy to second RAM
	EPD_GDEY029T71H_SendCommand(0x26);
	for (i = 0; i < EPD_GDEY029T71H_BUF_SIZE; i++)
	{
		EPD_GDEY029T71H_SendData(Image[i]);
	}
}

void EPD_GDEY029T71H_Display_Partial(UBYTE *Image)
{
	UWORD i;

	// Write image to RAM (only RAM 0x24, not 0x26)
	EPD_GDEY029T71H_SendCommand(0x24);
	for (i = 0; i < EPD_GDEY029T71H_BUF_SIZE; i++)
	{
		EPD_GDEY029T71H_SendData(Image[i]);
	}

	EPD_GDEY029T71H_TurnOnDisplay_Partial();
}

/******************************************************************************
function :	Enter sleep mode
parameter:
******************************************************************************/
void EPD_GDEY029T71H_Sleep(void)
{
	EPD_GDEY029T71H_SendCommand(0x10); // enter deep sleep
	EPD_GDEY029T71H_SendData(0x01);
	DEV_Delay_ms(100);
}


