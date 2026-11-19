"""README DEMO GIF, step 2 of 2: stitches the snapshots from scripts/demo-frames.ts into
docs/images/demo.gif, with a caption bar on each frame. Needs Python 3 with Pillow.
Run both steps with:  npm run gif
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "docs" / ".gif-frames"
OUT = ROOT / "docs" / "images" / "demo.gif"
WIDTH = 1000  # final GIF width in pixels
BAR = 46  # caption bar height
FONT = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 19)

frames, durations = [], []
for f in json.loads((FRAMES / "frames.json").read_text()):
    img = Image.open(FRAMES / f["file"]).convert("RGB")
    img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
    canvas = Image.new("RGB", (WIDTH, img.height + BAR), (21, 24, 29))
    canvas.paste(img, (0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.text((WIDTH / 2, img.height + BAR / 2), f["caption"], font=FONT, fill=(79, 209, 176), anchor="mm")
    frames.append(canvas.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    durations.append(f["ms"])

frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(f"Saved {OUT} ({len(frames)} frames, {OUT.stat().st_size / 1e6:.1f} MB)")
