"""
PlatformIO post-build script to create merged firmware binary for ESP Web Tools.
This script merges bootloader, partitions, and application into a single flashable binary.
"""
Import("env")

import os
import shutil

def merge_bin(source, target, env):
    """Create merged binary after successful build"""
    
    # Get build directory and firmware name
    build_dir = env.subst("$BUILD_DIR")
    env_name = env.subst("$PIOENV")
    project_dir = env.subst("$PROJECT_DIR")
    
    # Paths to individual binaries
    bootloader = os.path.join(build_dir, "bootloader.bin")
    partitions = os.path.join(build_dir, "partitions.bin")
    firmware = os.path.join(build_dir, "firmware.bin")
    
    # Output path for merged binary
    merged_output = os.path.join(build_dir, "firmware_merged.bin")
    
    # Check if all required files exist
    if not all(os.path.exists(f) for f in [bootloader, partitions, firmware]):
        print("WARNING: Not all binary files found, skipping merge")
        return
    
    # ESP32 flash offsets (default layout)
    # Bootloader: 0x1000
    # Partitions: 0x8000
    # Application: 0x10000
    
    BOOTLOADER_OFFSET = 0x1000
    PARTITIONS_OFFSET = 0x8000
    APP_OFFSET = 0x10000
    
    print(f"Creating merged firmware for {env_name}...")
    
    with open(merged_output, "wb") as merged:
        # Fill with 0xFF up to bootloader offset
        merged.write(b'\xFF' * BOOTLOADER_OFFSET)
        
        # Write bootloader
        with open(bootloader, "rb") as bl:
            merged.write(bl.read())
        
        # Pad to partitions offset
        current_pos = merged.tell()
        if current_pos < PARTITIONS_OFFSET:
            merged.write(b'\xFF' * (PARTITIONS_OFFSET - current_pos))
        
        # Write partitions
        with open(partitions, "rb") as pt:
            merged.write(pt.read())
        
        # Pad to app offset
        current_pos = merged.tell()
        if current_pos < APP_OFFSET:
            merged.write(b'\xFF' * (APP_OFFSET - current_pos))
        
        # Write application
        with open(firmware, "rb") as fw:
            merged.write(fw.read())
    
    merged_size = os.path.getsize(merged_output)
    print(f"Merged firmware created: {merged_output}")
    print(f"Size: {merged_size:,} bytes ({merged_size / 1024 / 1024:.2f} MB)")
    
    # Auto-copy to docs directory based on environment (for GitHub Pages)
    docs_dir = os.path.join(project_dir, "..", "docs", "firmware")
    
    if env_name == "esp32demo":
        dest_dir = os.path.join(docs_dir, "demo")
    elif env_name == "esp32api":
        dest_dir = os.path.join(docs_dir, "prod")
    else:
        dest_dir = None
    
    if dest_dir and os.path.exists(os.path.dirname(dest_dir)):
        os.makedirs(dest_dir, exist_ok=True)
        dest_file = os.path.join(dest_dir, "firmware.bin")
        shutil.copy2(merged_output, dest_file)
        print(f"Copied to: {dest_file}")

# Register post-build action
env.AddPostAction("$BUILD_DIR/firmware.bin", merge_bin)
