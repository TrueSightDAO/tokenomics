#!/usr/bin/env python3
"""
Agroverse QR Code Generator

Generate a QR code image for a specified URL and save it as a PNG.

Usage:
    python agroverse_qr_code_generator.py [--url URL] [--output FILE] [--size N] [--border N]

Dependencies:
    pip install qrcode[pil]
"""

import argparse

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_M
except ImportError:
    raise ImportError(
        "Missing dependency 'qrcode'. Install with: pip install qrcode[pil]"
    )

# Import Pillow for optional logo overlay
try:
    from PIL import Image
except ImportError:
    raise ImportError("Missing dependency 'Pillow'. Install with: pip install pillow")


def generate_qr(url: str, output_file: str, box_size: int = 10, border: int = 4, logo_path: str = None, logo_ratio: float = 0.2) -> None:
    """
    Generate and save a QR code for the given URL.

    :param url: URL or text to encode in the QR code.
    :param output_file: Path to the output PNG file.
    :param box_size: Pixel size of each QR code box.
    :param border: Width of the border (box units).
    :param logo_path: Path to optional logo image to overlay at the center.
    :param logo_ratio: Fraction of the QR code size for the logo (0 < ratio <= 1).
    """
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    # Generate image with default black modules and white background
    img = qr.make_image(fill_color="#000000", back_color="white")
    # Overlay logo if provided
    if logo_path:
        img = img.convert("RGBA")
        logo = Image.open(logo_path).convert("RGBA")
        qr_width, qr_height = img.size
        max_logo_size = int(min(qr_width, qr_height) * logo_ratio)
        # use LANCZOS resampling for thumbnail (ANTIALIAS removed in newer Pillow)
        try:
            resample_method = Image.Resampling.LANCZOS
        except AttributeError:
            resample_method = Image.LANCZOS
        logo.thumbnail((max_logo_size, max_logo_size), resample_method)
        logo_width, logo_height = logo.size
        pos = ((qr_width - logo_width) // 2, (qr_height - logo_height) // 2)
        img.paste(logo, pos, logo)
    img.save(output_file)
    print(f"QR code saved to '{output_file}' for URL: {url}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate a QR code for a URL and save as PNG."
    )
    parser.add_argument(
        "--url", dest="url",
        default="https://www.instagram.com/p/DI92I-ITJcW/",
        help="URL to encode in the QR code (default: Instagram post).",
    )
    parser.add_argument(
        "--output", dest="output",
        default="qr.png",
        help="Output PNG filename (default: qr.png)",
    )
    parser.add_argument(
        "--size", dest="size", type=int,
        default=10,
        help="Box size for QR code pixels (default: 10)",
    )
    parser.add_argument(
        "--border", dest="border", type=int,
        default=4,
        help="Border width in boxes (default: 4)",
    )
    parser.add_argument(
        "--logo", dest="logo", default=None,
        help="Path to a logo image to overlay at the center",
    )
    parser.add_argument(
        "--logo-ratio", dest="logo_ratio", type=float,
        default=0.2,
        help="Fraction of the QR code size for the logo (0 < ratio <= 1; default: 0.2)",
    )
    args = parser.parse_args()
    generate_qr(args.url, args.output, args.size, args.border, args.logo, args.logo_ratio)


if __name__ == "__main__":  # pragma: no cover
    main()
