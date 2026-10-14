"""Render the USB Device Tree extension icon with Pillow."""

from pathlib import Path

from PIL import Image, ImageDraw


SCALE = 4
SIZE = 256


def box(*values):
    return tuple(round(value * SCALE) for value in values)


def main():
    image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(box(12, 12, 244, 244), radius=52 * SCALE,
                           fill="#101B25", outline="#29424C", width=3 * SCALE)
    draw.rounded_rectangle(box(25, 25, 231, 231), radius=39 * SCALE,
                           outline="#17313B", width=2 * SCALE)

    wire = "#62CFC9"
    draw.line(box(128, 103, 128, 136), fill=wire, width=11 * SCALE)
    draw.line(box(65, 136, 191, 136), fill=wire, width=11 * SCALE)
    for x in (65, 128, 191):
        draw.line(box(x, 136, x, 162), fill=wire, width=11 * SCALE)

    draw.rounded_rectangle(box(98, 48, 158, 106), radius=18 * SCALE,
                           fill="#18434B", outline="#77E1D3", width=7 * SCALE)
    draw.ellipse(box(117, 67, 139, 89), fill="#E4FFF6")

    draw.ellipse(box(43, 160, 87, 204), fill="#5CD89C")
    draw.ellipse(box(55, 172, 75, 192), fill="#D5FFE7")

    draw.rounded_rectangle(box(106, 160, 150, 204), radius=11 * SCALE,
                           fill="#E8F5F3")
    draw.rounded_rectangle(box(117, 171, 139, 193), radius=5 * SCALE,
                           fill="#214751")

    draw.polygon([box(191, 158), box(215, 182), box(191, 206), box(167, 182)],
                 fill="#50BFD8")
    draw.polygon([box(191, 171), box(202, 182), box(191, 193), box(180, 182)],
                 fill="#D9F8FF")

    output = Path(__file__).resolve().parents[1] / "resources" / "extension-icon.png"
    image.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(output, optimize=True)
    print(output)


if __name__ == "__main__":
    main()
