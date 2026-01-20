# TigerMeter Flash Page

Web-based firmware flashing tool using [ESP Web Tools](https://esphome.github.io/esp-web-tools/).

## Usage

### Building Firmware

1. Navigate to firmware directory:
   ```bash
   cd firmware
   ```

2. Build the desired firmware:
   ```bash
   # For Demo mode
   pio run -e esp32demo
   
   # For Production mode
   pio run -e esp32api
   ```

3. The merged binary will be automatically copied to `flash-page/firmware/demo/` or `flash-page/firmware/prod/`

### Hosting on GitHub Pages

1. Go to your repository Settings → Pages
2. Set Source to "Deploy from a branch"
3. Select branch: `main`, folder: `/flash-page`
4. Save and wait for deployment

Your flash page will be available at:
`https://<username>.github.io/<repo>/`

### Manual Firmware Placement

If auto-copy doesn't work, manually copy the merged binary:

```bash
# Demo
cp firmware/.pio/build/esp32demo/firmware_merged.bin flash-page/firmware/demo/firmware.bin

# Production
cp firmware/.pio/build/esp32api/firmware_merged.bin flash-page/firmware/prod/firmware.bin
```

## Browser Requirements

Web Serial API is only supported in:
- Chrome 89+ (Desktop)
- Edge 89+ (Desktop)  
- Opera 75+ (Desktop)

Safari and Firefox are **not** supported.

## File Structure

```
flash-page/
├── index.html           # Main web page
├── manifest-demo.json   # ESP Web Tools manifest for demo firmware
├── manifest-prod.json   # ESP Web Tools manifest for production firmware
├── firmware/
│   ├── demo/
│   │   └── firmware.bin # Demo merged binary
│   └── prod/
│       └── firmware.bin # Production merged binary
└── README.md            # This file
```
