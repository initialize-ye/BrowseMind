from PIL import Image, ImageDraw
import os

def create_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 圆角矩形背景
    color = (102, 126, 234)  # #667eea
    radius = int(size * 0.2)
    draw.rounded_rectangle([(0, 0), (size, size)], radius=radius, fill=color)

    # 绘制简化脑形图标（白色）
    s = size
    cx, cy = s * 0.5, s * 0.48
    r = s * 0.28
    white = (255, 255, 255, 255)
    lw = max(2, int(s * 0.06))

    # 左半脑
    draw.arc([cx - r, cy - r, cx + r * 0.1, cy + r], 180, 0, fill=white, width=lw)
    # 右半脑
    draw.arc([cx - r * 0.1, cy - r, cx + r, cy + r], 180, 0, fill=white, width=lw)
    # 中间连接线
    draw.line([(cx, cy - r), (cx, cy + r)], fill=white, width=lw)
    # 底部连接
    draw.arc([cx - r * 0.6, cy + r * 0.3, cx + r * 0.6, cy + r * 1.1], 0, 180, fill=white, width=lw)

    img.save(f'icon{size}.png')
    print(f'已生成 icon{size}.png')

# 生成三个尺寸的图标
for size in [16, 48, 128]:
    create_icon(size)
