from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size):
    # 创建图像
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 绘制渐变背景（简化为纯色）
    color = (102, 126, 234)  # #667eea
    radius = int(size * 0.2)

    # 绘制圆角矩形
    draw.rounded_rectangle([(0, 0), (size, size)], radius=radius, fill=color)

    # 添加文字（大脑emoji）
    try:
        font_size = int(size * 0.5)
        font = ImageFont.truetype("seguiemj.ttf", font_size)  # Windows emoji字体
    except:
        font = ImageFont.load_default()

    text = "🧠"
    # 使用textbbox获取文字边界
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    position = ((size - text_width) // 2, (size - text_height) // 2 - bbox[1])
    draw.text(position, text, fill='white', font=font)

    # 保存
    img.save(f'icon{size}.png')
    print(f'已生成 icon{size}.png')

# 生成三个尺寸的图标
for size in [16, 48, 128]:
    create_icon(size)
