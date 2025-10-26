@echo off
setlocal

REM One-click flasher for demo firmware (Windows)
REM - Installs PlatformIO via Python if missing
REM - Builds & uploads env:esp32demo (auto-detects COM port)

REM Change to repo/firmware directory
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

echo === TigerMeter Demo Firmware Flasher ===

REM Ensure Python launcher exists
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher 'py' not found. Please install Python 3.x from https://www.python.org/downloads/
  echo and ensure the 'py' launcher is in PATH.
  pause
  exit /b 1
)

echo Checking PlatformIO...
py -m platformio --version >nul 2>&1
if errorlevel 1 (
  echo PlatformIO not found. Installing (this may take a few minutes)...
  py -m pip install --user -U platformio
  if errorlevel 1 (
    echo Failed to install PlatformIO. Please install manually: pip install -U platformio
    pause
    exit /b 1
  )
)

echo.
echo Detected serial ports:
py -m platformio device list

echo.
echo Connect your ESP32 (if not already), then press any key to start flashing demo firmware.
pause >nul

echo Building and uploading demo (env: esp32demo)...
py -m platformio run -e esp32demo -t upload
if errorlevel 1 (
  echo Upload failed. If multiple boards are connected, specify COM port manually:
  echo   py -m platformio run -e esp32demo -t upload --upload-port COM3
  pause
  exit /b 1
)

echo.
echo Done! The device should now run the looping demo (HELLO -> LEDs+beep -> strongest WiFi SSID).
pause
exit /b 0


