#ifndef _TYPES_H_
#define _TYPES_H_

// Common type definitions used across all build modes
// These must match the definitions in ApiClient.h

// Use guards that ApiClient.h can check to avoid redefinition
#ifndef FONTSIZETYPE_DEFINED
#define FONTSIZETYPE_DEFINED
enum FontSizeType { FONT_SMALL, FONT_MID, FONT_LARGE };
#endif

#ifndef TEXTALIGNTYPE_DEFINED
#define TEXTALIGNTYPE_DEFINED
enum TextAlignType { ALIGN_LEFT, ALIGN_CENTER, ALIGN_RIGHT };
#endif

#ifndef DEVICESTATE_DEFINED
#define DEVICESTATE_DEFINED
enum DeviceState { STATE_UNCLAIMED, STATE_CLAIMING, STATE_WAITING_ATTACH, STATE_ACTIVE, STATE_ERROR };
#endif

#endif // _TYPES_H_
