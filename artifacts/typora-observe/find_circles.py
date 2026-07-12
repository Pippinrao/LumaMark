from PIL import Image
from collections import defaultdict

img = Image.open(r"E:\workspace\codes\LumaMark\artifacts\typora-observe\220-now.png").convert("RGB")
w, h = img.size
print("size", w, h)

# Find filled dark circles (checked)
dark_hits = []
for y in range(200, 800, 2):
    for x in range(300, 900, 2):
        r, g, b = img.getpixel((x, y))
        if r < 50 and g < 50 and b < 50:
            # neighborhood dark density
            dark = 0
            for dy in range(-6, 7):
                for dx in range(-6, 7):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h:
                        rr, gg, bb = img.getpixel((xx, yy))
                        if rr < 70 and gg < 70 and bb < 70:
                            dark += 1
            if dark > 80:
                dark_hits.append((x, y, dark))

clusters = defaultdict(list)
for x, y, d in dark_hits:
    clusters[(x // 12, y // 12)].append((x, y, d))

print("dark clusters:")
for k, v in sorted(clusters.items(), key=lambda kv: -len(kv[1]))[:10]:
    xs = [p[0] for p in v]
    ys = [p[1] for p in v]
    print(f"  n={len(v)} x={sum(xs)//len(xs)} y={sum(ys)//len(ys)}")

# Save zoom around likely task area (y~450-600 based on previous)
for name, box in [("zoom1", (400, 420, 700, 620)), ("zoom2", (350, 350, 650, 550))]:
    crop = img.crop(box)
    crop.save(fr"E:\workspace\codes\LumaMark\artifacts\typora-observe\222-{name}.png")
    print("saved", name, box)
