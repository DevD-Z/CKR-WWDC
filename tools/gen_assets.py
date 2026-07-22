"""Generate original decorative PNGs (not ripped game assets)."""
from PIL import Image, ImageDraw, ImageFilter
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "static", "assets")
os.makedirs(OUT, exist_ok=True)


def soft_circle(size, fill, soft=18):
    img = Image.new("RGBA", (size + soft * 2, size + soft * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((soft, soft, soft + size, soft + size), fill=fill)
    return img.filter(ImageFilter.GaussianBlur(soft // 3))


crumb = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
d = ImageDraw.Draw(crumb)
d.ellipse((8, 8, 120, 120), fill=(214, 166, 90, 255))
d.ellipse((22, 22, 106, 106), fill=(232, 196, 130, 255))
for xy in [(45, 40), (70, 55), (50, 75), (78, 78), (40, 60)]:
    d.ellipse((xy[0], xy[1], xy[0] + 14, xy[1] + 14), fill=(92, 54, 28, 255))
crumb.save(os.path.join(OUT, "deco_cookie.png"))

soft_circle(160, (255, 86, 0, 40), soft=40).save(os.path.join(OUT, "deco_glow.png"))

coin = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
d = ImageDraw.Draw(coin)
d.ellipse((4, 4, 92, 92), fill=(255, 196, 64, 255))
d.ellipse((14, 14, 82, 82), fill=(255, 220, 120, 255))
d.ellipse((30, 30, 66, 66), fill=(230, 160, 40, 255))
coin.save(os.path.join(OUT, "deco_token.png"))

star = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
d = ImageDraw.Draw(star)
d.polygon(
    [
        (32, 4),
        (38, 24),
        (60, 24),
        (42, 38),
        (48, 58),
        (32, 46),
        (16, 58),
        (22, 38),
        (4, 24),
        (26, 24),
    ],
    fill=(255, 86, 0, 200),
)
star.save(os.path.join(OUT, "deco_star.png"))

tile = Image.new("RGBA", (240, 240), (245, 241, 236, 255))
d = ImageDraw.Draw(tile)
for i in range(0, 240, 40):
    for j in range(0, 240, 40):
        if (i // 40 + j // 40) % 2 == 0:
            d.ellipse((i + 10, j + 10, i + 28, j + 28), fill=(235, 228, 218, 255))
tile.save(os.path.join(OUT, "deco_pattern.png"))

print("wrote", sorted(os.listdir(OUT)))
