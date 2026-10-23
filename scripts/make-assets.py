"""Make original demo art, short test clips, and MK icons. No private media is used."""
from pathlib import Path
import json
import math
import random
import shutil
import subprocess
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demo"
FONTS = ROOT / "fonts"


def download_fonts():
    FONTS.mkdir(exist_ok=True)
    families = {
        "cormorant-garamond": ["latin-400-normal", "latin-500-normal"],
        "dm-sans": ["latin-400-normal", "latin-600-normal"],
        "noto-sans-arabic": ["arabic-400-normal", "arabic-600-normal"],
    }
    notes = ["# Local fonts", "", "All fonts use the SIL Open Font License 1.1. Font files are hosted locally.", ""]
    for family, variants in families.items():
        base = f"https://cdn.jsdelivr.net/npm/@fontsource/{family}@5.2.8"
        # The pinned package provides the exact font and its upstream OFL text.
        try:
            license_text = urllib.request.urlopen(f"{base}/LICENSE", timeout=30).read()
        except Exception:
            base = f"https://cdn.jsdelivr.net/npm/@fontsource/{family}@5.2.7"
            license_text = urllib.request.urlopen(f"{base}/LICENSE", timeout=30).read()
        assert b"SIL OPEN FONT LICENSE" in license_text.upper(), family
        (FONTS / f"{family}-OFL.txt").write_bytes(license_text)
        for variant in variants:
            name = f"{family}-{variant}.woff2"
            data = urllib.request.urlopen(f"{base}/files/{name}", timeout=30).read()
            assert data[:4] == b"wOF2", name
            (FONTS / name).write_bytes(data)
        notes.extend([f"- {family}: {base}", f"  License: {family}-OFL.txt"])
    (FONTS / "README.md").write_text("\n".join(notes) + "\n", encoding="utf-8")


def poster(index, portrait):
    width, height = (720, 1280) if portrait else (960, 540)
    random.seed(941 + index)
    image = Image.new("RGB", (width, height))
    pixels = image.load()
    # A warm spotlight, stone grain, and a deep shadow form an original cinema set.
    for y in range(height):
        for x in range(width):
            light = math.exp(-(((x / width - .54) / .46) ** 2 + ((y / height - .34) / .48) ** 2))
            grain = random.uniform(-4, 4)
            pixels[x, y] = tuple(max(0, min(255, int(a + b * light + grain))) for a, b in [(18, 96), (13, 65), (13, 34)])
    draw = ImageDraw.Draw(image)
    cx, top, bottom = width * .52, height * .16, height * .88
    arch_width = width * (.59 if portrait else .35)
    for depth in range(6):
        inset = depth * width * .027
        box = (cx - arch_width / 2 + inset, top + inset, cx + arch_width / 2 - inset, bottom)
        tone = (139 - depth * 16, 103 - depth * 13, 58 - depth * 7)
        draw.rounded_rectangle(box, radius=arch_width / 2 - inset, fill=tone)
        draw.rectangle((box[0], top + arch_width / 2, box[2], bottom), fill=tone)
    draw.rectangle((cx - width * .13, height * .52, cx + width * .13, bottom), fill=(15, 12, 12))
    floor_y = height * .72
    for step in range(9):
        y0 = floor_y + step * height * .027
        half = width * (.10 + step * .047)
        draw.polygon([(cx-half, y0), (cx+half, y0), (cx+half+width*.05, y0+height*.027), (cx-half-width*.05, y0+height*.027)], fill=(98-step*6, 67-step*4, 37-step*2))
        draw.line((cx-half, y0, cx+half, y0), fill=(176-step*9, 129-step*7, 70-step*4), width=2)
    if index % 3 == 1:
        # Tall fluted columns add a second quiet architectural composition.
        for column in [width * .08, width * .83]:
            draw.rectangle((column, height*.12, column+width*.09, height*.9), fill=(63, 39, 27))
            for stripe in range(5):
                x = column + stripe * width * .018
                draw.line((x, height*.13, x, height*.9), fill=(98, 66, 39), width=3)
    if index % 3 == 2:
        draw.ellipse((width*.08, height*.15, width*.32, height*.15+width*.24), fill=(206, 164, 95))
        draw.rectangle((0, height*.79, width, height), fill=(25, 18, 17))
        for stripe in range(8):
            draw.line((width*.1, height*(.81+stripe*.022), width*.94, height*(.81+stripe*.022)), fill=(72, 46, 28), width=2)
    veil = Image.new("RGBA", image.size)
    vd = ImageDraw.Draw(veil)
    for y in range(height):
        alpha = int(150 * (y / height) ** 3)
        vd.line((0, y, width, y), fill=(12, 8, 10, alpha))
    return Image.alpha_composite(image.convert("RGBA"), veil).convert("RGB")


def make_icons():
    size = 1024
    image = Image.new("RGB", (size, size), "#100c0d")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((40, 40, 984, 984), radius=190, outline="#493b3c", width=5)
    draw.line((274, 280, 750, 280), fill="#d8b777", width=5)
    font = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 300)
    bounds = draw.textbbox((0, 0), "MK", font=font)
    draw.text(((size - bounds[2]) / 2, 330 - bounds[1]), "MK", font=font, fill="#d8b777")
    sans = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 68)
    label = "C I N E M A"
    bounds = draw.textbbox((0, 0), label, font=sans)
    draw.text(((size - bounds[2]) / 2, 690), label, font=sans, fill="#f5efe5")
    for target in [180, 192, 512]:
        image.resize((target, target), Image.Resampling.LANCZOS).save(ROOT / f"icon-{target}.png")
    image.resize((48, 48), Image.Resampling.LANCZOS).save(ROOT / "favicon.png")


CLIPS = ["golden-hour", "light-journey", "velvet-steps", "amber-room", "quiet-city", "last-light", "paper-moon"]


def make_videos():
    """One 12-second clip per film and shape: a slow push-in on its own poster with a light beam sweeping across."""
    ffmpeg = shutil.which("ffmpeg")
    assert ffmpeg, "ffmpeg is required"
    for index, slug in enumerate(CLIPS):
        for kind, (width, height) in [("phone", (360, 640)), ("desktop", (640, 360))]:
            if kind == "desktop" and slug == "velvet-steps":
                continue
            dest = DEMO / f"{slug}-{kind}.mp4"
            # The beam brightens luma only, so the poster keeps its colours. Each film starts it at a different place.
            glow = f"exp(-pow((X+Y*0.35-(W*1.6)*mod(T+{index * 1.7:.1f},12)/12+W*0.1)/(W*0.13),2))"
            chain = (f"scale={width * 2}:{height * 2}:force_original_aspect_ratio=increase,crop={width * 2}:{height * 2},"
                     f"zoompan=z='1+0.16*(1-cos(PI*on/360))/2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={width}x{height}:fps=30,"
                     f"format=yuv420p,geq=lum='clip(lum(X,Y)+70*{glow},0,255)':cb='cb(X,Y)-6*{glow}':cr='cr(X,Y)+8*{glow}'")
            # -g 12 puts a keyframe every 0.4 s, so scroll-driven scrubbing and backward seeks stay cheap.
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-t", "12", "-i", str(DEMO / "posters" / f"{slug}.jpg"), "-vf", chain, "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-g", "12", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(dest)], check=True)
            assert dest.stat().st_size <= 400_000, dest


def make_catalog():
    entries = [
        ("golden-hour", "Golden Hour", True, False),
        ("light-journey", "رحلة الضوء", False, False),
        ("velvet-steps", "Velvet Steps", True, True),
        ("amber-room", "The Amber Room", False, False),
        ("quiet-city", "A Quiet City", False, False),
        ("last-light", "Last Light", True, False),
        ("paper-moon", "Paper Moon Passage", False, False),
    ]
    films = []
    (DEMO / "posters").mkdir(parents=True, exist_ok=True)
    for index, (slug, title, portrait, phone_only) in enumerate(entries):
        poster(index, portrait).save(DEMO / "posters" / f"{slug}.jpg", quality=88, optimize=True)
        versions = []
        for kind, width, height in [("phone", 360, 640), ("desktop", 640, 360)]:
            if phone_only and kind == "desktop":
                continue
            path = f"demo/{slug}-{kind}.mp4"
            versions.append({"kind": kind, "file": path, "w": width, "h": height, "bytes": (ROOT / path).stat().st_size})
        films.append({"id": slug, "title": title, "dir": "rtl" if index == 1 else "ltr", "seconds": 12, "added": f"2026-10-{22-index:02}", "poster": f"demo/posters/{slug}.jpg", "posterShape": "9:16" if portrait else "16:9", "versions": versions, "release": f"demo-{slug}"})
    (DEMO / "cinema.json").write_text(json.dumps({"version": 1, "updated": "2026-10-22T12:00:00Z", "films": films}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    DEMO.mkdir(exist_ok=True)
    download_fonts()
    make_icons()
    make_videos()
    make_catalog()
    print("Created local OFL fonts, icons, seven original posters, and one 12-second clip per film and shape.")
