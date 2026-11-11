#!/usr/bin/env python3
"""Composite a HUD overlay screenshot over a rendered frame:  compose.py frame.png [out.jpg]"""
import sys
from PIL import Image
frame = Image.open(sys.argv[1]).convert('RGBA')
hud = Image.open(sys.argv[1].replace('.png', '_hud.png')).convert('RGBA').resize(frame.size)
frame.alpha_composite(hud)
frame.convert('RGB').save(sys.argv[2] if len(sys.argv) > 2 else sys.argv[1].replace('.png', '_full.jpg'), quality=90)
