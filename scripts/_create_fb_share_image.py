from PIL import Image, ImageDraw

# Open the logo
logo = Image.open('images/yeh_main_logo.png').convert('RGBA')

# Target: 1200x630 Facebook share card
W, H = 1200, 630

# Create dark background matching site theme (#1a1a2e)
bg = Image.new('RGBA', (W, H), (26, 26, 46, 255))

# Scale logo to fit within 1050px wide (leaving comfortable padding)
logo_w = 1050
logo_h = int(logo.height * (logo_w / logo.width))
logo_scaled = logo.resize((logo_w, logo_h), Image.LANCZOS)

# Center the logo
x = (W - logo_w) // 2
y = (H - logo_h) // 2

# Paste logo onto background
bg.paste(logo_scaled, (x, y), logo_scaled)

# Subtle orange accent bar at top (#e67e22)
draw = ImageDraw.Draw(bg)
draw.rectangle([(0, 0), (W, 5)], fill=(230, 126, 34, 255))

# Add tagline below logo
# (keeping it clean — logo + accent bar is enough)

# Save
bg.save('images/yeh_share_fb.png', 'PNG', optimize=True)
print(f'Created images/yeh_share_fb.png: {W}x{H}')
