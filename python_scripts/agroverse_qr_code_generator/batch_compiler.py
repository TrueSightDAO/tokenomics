#!/usr/bin/env python3
"""
Batch compile QR codes into labeled images.

Fetch QR code values and farm names from a Google Sheet,
generate QR codes pointing to the check URL, embed each QR code
into a template image, annotate above with farm name and below with serial.
Save compiled images to an output directory and a to_print subdirectory for new images.
"""
import argparse
import os
import re
try:
    import gdrive
    from googleapiclient.discovery import build
except ImportError:
    gdrive = None
    build = None

import qrcode
from qrcode.constants import ERROR_CORRECT_M

from PIL import Image, ImageDraw, ImageFont

# Layout and scaling constants
CANVAS_BASE_WIDTH = 450        # base width for blank canvas (px)
CANVAS_BASE_HEIGHT = 350       # base height for blank canvas (px)
CANVAS_SCALE = 1              # scale factor for blank canvas
QR_BASE_SIZE = 320            # base QR size for blank canvas before scaling (px)
QR_RATIO = 0.5                 # QR size as fraction of template width when template provided

# Font size defaults (in pixels)
DEFAULT_HARVEST_FONT_SIZE = 18 # default font size for harvest/pledge line
DEFAULT_INFO_FONT_SIZE = 25   # default font size for info line
DEFAULT_PLANT_FONT_SIZE = 20   # default font size for plant line
DEFAULT_SERIAL_FONT_SIZE = 22   # default font size for plant line
MIN_FONT_RATIO = 0.02          # minimum font size as fraction of canvas height
MIN_FONT_SIZE = 6              # absolute minimum font size in pixels

# Spacing ratios relative to canvas height
SIDE_MARGIN_RATIO = 0.05       # horizontal side margin as fraction of canvas width
QR_TO_HARVEST_RATIO = 0.0001  # vertical space from QR to harvest/pledge line
HARVEST_TO_INFO_RATIO = 0.10   # vertical space from harvest/pledge to info line
INFO_TO_PLANT_RATIO = 0.07     # vertical space from info to plant line
PLANT_TO_SERIAL_RATIO = 0.07   # vertical space from plant to serial line
BOTTOM_MARGIN_RATIO = 0.05     # bottom margin as fraction of canvas height
RIGHT_MARGIN_SERIAL_RATIO = 0.05

# Manual fixed positions (in pixels) to override dynamic layout. Set to None to use auto-layout
FIXED_QR_Y = -30              # override QR Y position (px); e.g., -30
FIXED_HARVEST_Y = 250         # override harvest/pledge text Y position (px)
FIXED_INFO_Y = 270            # override info text Y position (px)
FIXED_PLANT_Y = 300           # override plant text Y position (px)
FIXED_SERIAL_Y = 325          # override serial text Y position (px)

# Default font family for text
DEFAULT_FONT_FAMILY = "Helvetica.ttc"


def extract_sheet_id(sheet_url: str) -> str:
    match = re.search(r'/d/([a-zA-Z0-9-_]+)', sheet_url)
    if not match:
        raise ValueError(f"Could not parse spreadsheet ID from URL: {sheet_url}")
    return match.group(1)


def fetch_rows(credentials_path: str, sheet_url: str, sheet_name: str):
    """
    Fetch rows from Google Sheet, returning list of tuples (qr_code, farm_name, state, country, year, is_cacao).
    """
    client = gdrive.GDrive(credentials_path=credentials_path)
    sheet_id = extract_sheet_id(sheet_url)
    service = build('sheets', 'v4', credentials=client.creds)
    # We expect columns: A=QR code, B=URL, E=Farm Name, F=State, G=Country, H=Year
    range_name = f"'{sheet_name}'!A2:H"
    result = service.spreadsheets().values().get(
        spreadsheetId=sheet_id, range=range_name
    ).execute()
    values = result.get('values', [])
    rows = []
    for row in values:
        if not row:
            continue
        qr_code = row[0].strip()
        url = row[1].strip() if len(row) >= 2 else ''
        farm_name = row[4].strip() if len(row) >= 5 else ''
        state = row[5].strip() if len(row) >= 6 else ''
        country = row[6].strip() if len(row) >= 7 else ''
        year = row[7].strip() if len(row) >= 8 else ''
        # Determine if item is cacao based on URL in column B
        is_cacao = url.startswith('https://www.agroverse.shop')
        if qr_code:
            rows.append((qr_code, farm_name, state, country, year, is_cacao))
    return rows


def generate_qr_image(url: str, box_size: int = 10, border: int = 4, logo_path: str = None, logo_ratio: float = 0.2):
    """
    Generate QR Code image for given URL, optionally embed a logo at center.

    :param url: URL or data to encode.
    :param box_size: size of each QR box.
    :param border: border size in boxes.
    :param logo_path: path to logo image file to embed at center.
    :param logo_ratio: fraction of QR code dimension for logo size.
    """
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    # Embed logo if provided
    if logo_path:
        try:
            logo = Image.open(logo_path).convert("RGBA")
        except Exception as e:
            raise ValueError(f"Unable to open logo image '{logo_path}': {e}")
        qr_w, qr_h = img.size
        max_logo_size = int(min(qr_w, qr_h) * logo_ratio)
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:
            resample = Image.LANCZOS
        logo.thumbnail((max_logo_size, max_logo_size), resample)
        lw, lh = logo.size
        pos = ((qr_w - lw) // 2, (qr_h - lh) // 2)
        img.paste(logo, pos, logo)
    return img




def compile_image(template_path: str,
                  qr_img: Image.Image,
                  farm_name: str,
                  state: str,
                  country: str,
                  year: str,
                  serial: str,
                  is_cacao: bool,
                  font_family: str = DEFAULT_FONT_FAMILY,
                  harvest_font_size: int = DEFAULT_HARVEST_FONT_SIZE,
                  info_font_size: int = DEFAULT_INFO_FONT_SIZE,
                  plant_font_size: int = DEFAULT_PLANT_FONT_SIZE,
                  ignore_max_width: bool = False):
    """
    Embed QR code into the provided template image, annotate with:
      - Above QR: (none)
      - Below QR: Harvest <year> (for cacao, if year exists) or Pledge Year <year> (for non-cacao, if year exists) or Pledge Confirmed
                  Farm Name, State, Country
                  Your tree is getting planted
      - Right side, vertical: <serial> (rotated 90 degrees counterclockwise)
    Spacing and font sizes are set explicitly or use defaults.
    :param is_cacao: True if item is cacao, False otherwise.
    :param ignore_max_width: if True, skip auto-resizing to fit text width constraints.
    """
    # Determine canvas size and QR size; blank canvas is scaled up by factor
    scale = CANVAS_SCALE
    if template_path:
        template = Image.open(template_path).convert("RGBA")
        bg_w, bg_h = template.size
        qr_size = int(bg_w * QR_RATIO)
    else:
        # Base blank dimensions and QR size
        bg_w = CANVAS_BASE_WIDTH * scale
        bg_h = CANVAS_BASE_HEIGHT * scale
        template = Image.new("RGBA", (bg_w, bg_h), (255, 255, 255, 255))
        qr_size = QR_BASE_SIZE * scale
    try:
        resample = Image.Resampling.LANCZOS
    except AttributeError:
        resample = Image.LANCZOS
    qr_img = qr_img.resize((qr_size, qr_size), resample)
    qr_w, qr_h = qr_img.size
    draw = ImageDraw.Draw(template)

    # Helper to measure text size (w, h)
    def text_size(txt, fnt):
        if hasattr(draw, 'textbbox'):
            bbox = draw.textbbox((0, 0), txt, font=fnt)
            return bbox[2] - bbox[0], bbox[3] - bbox[1]
        else:
            mask = fnt.getmask(txt)
            return mask.size

    # Helper to load a TrueType font by given family or path, with fallbacks
    def load_font(size):
        try:
            return ImageFont.truetype('cour.ttf', size)  # Prefer Courier New for clear underscore rendering
        except Exception:
            try:
                return ImageFont.truetype('arial.ttf', size)
            except Exception:
                try:
                    return ImageFont.truetype(font_family, size)
                except Exception:
                    base, ext = os.path.splitext(font_family)
                    if not ext:
                        for try_ext in ('.ttf', '.ttc'):
                            try:
                                return ImageFont.truetype(font_family + try_ext, size)
                            except Exception:
                                continue
                    return ImageFont.load_default()

    # Prepare text lines
    if is_cacao:
        harvest_text = f"Harvest {year}" if year else "Pledge Confirmed"
    else:
        harvest_text = f"Restoring Rainforest since {year}" if year else "Restoring Rainforest"

    info_parts = [farm_name]
    if state:
        info_parts.append(state)
    if country:
        info_parts.append(country)
    info_text = ", ".join(info_parts)
    plant_text = "Your tree is getting planted"
    serial_text = serial
    print(f"Rendering serial text: '{serial_text}'")  # Debug to confirm underscore

    # Determine fonts and spacing
    side_margin = int(bg_w * SIDE_MARGIN_RATIO)
    right_margin_serial = int(bg_w * RIGHT_MARGIN_SERIAL_RATIO)
    max_width = bg_w - 2 * side_margin
    # Minimum font size (absolute or relative to canvas height)
    min_font = max(MIN_FONT_SIZE, int(bg_h * MIN_FONT_RATIO))

    # Set font sizes, ensuring they meet minimum constraints
    f_harvest_size = max(min_font, harvest_font_size)
    f_info_size = max(min_font, info_font_size)
    f_plant_size = max(min_font, plant_font_size)
    f_serial_size = max(min_font, DEFAULT_SERIAL_FONT_SIZE)

    # Load fonts
    f_harvest = load_font(f_harvest_size)
    f_info = load_font(f_info_size)
    f_plant = load_font(f_plant_size)
    f_serial = load_font(f_serial_size)

    # Measure text heights
    _, h1 = text_size(harvest_text, f_harvest)
    _, h2 = text_size(info_text, f_info)
    _, h3 = text_size(plant_text, f_plant)
    w_serial, h_serial = text_size(serial_text, f_serial)

    # Vertical spacing for text below QR
    m1 = int(bg_h * QR_TO_HARVEST_RATIO)
    m2 = int(bg_h * HARVEST_TO_INFO_RATIO)
    m3 = int(bg_h * INFO_TO_PLANT_RATIO)
    bottom_margin = int(bg_h * BOTTOM_MARGIN_RATIO)

    # Compute dynamic starting Y so content (excluding serial) sits above bottom margin
    total_h = qr_h + m1 + h1 + m2 + h2 + m3 + h3
    dynamic_start_y = bg_h - bottom_margin - total_h

    # Paste QR code (centered horizontally)
    qr_x = (bg_w - qr_w) // 2
    qr_y = FIXED_QR_Y if FIXED_QR_Y is not None else dynamic_start_y
    template.paste(qr_img, (qr_x, qr_y), qr_img)

    # Determine Y positions for text below QR (manual override or dynamic)
    harvest_y = FIXED_HARVEST_Y if FIXED_HARVEST_Y is not None else qr_y + qr_h + m1
    info_y    = FIXED_INFO_Y    if FIXED_INFO_Y    is not None else harvest_y + h1 + m2
    plant_y   = FIXED_PLANT_Y   if FIXED_PLANT_Y   is not None else info_y    + h2 + m3

    # Draw harvest/pledge text (centered horizontally)
    w_harvest, _ = text_size(harvest_text, f_harvest)
    x = (bg_w - w_harvest) // 2
    draw.text((x, harvest_y), harvest_text, fill="black", font=f_harvest)

    # Draw info text
    w_info, _ = text_size(info_text, f_info)
    x = (bg_w - w_info) // 2
    draw.text((x, info_y), info_text, fill="black", font=f_info)

    # Draw planting message
    w_plant, _ = text_size(plant_text, f_plant)
    x = (bg_w - w_plant) // 2
    draw.text((x, plant_y), plant_text, fill="black", font=f_plant)

    # Draw serial text (vertical, on the right)
    padding = 10
    serial_img = Image.new('RGBA', (w_serial + padding, h_serial + padding), (255, 255, 255, 0))
    serial_draw = ImageDraw.Draw(serial_img)
    serial_draw.text((padding // 2, padding // 2), serial_text, fill="black", font=f_serial)
    serial_img = serial_img.rotate(90, expand=True, resample=Image.Resampling.LANCZOS)
    sw, sh = serial_img.size
    serial_x = bg_w - right_margin_serial - sw
    serial_y = (bg_h - sh) // 2
    qr_right_edge = qr_x + qr_w
    if serial_x < qr_right_edge + side_margin:
        serial_x = qr_right_edge + side_margin
    template.paste(serial_img, (serial_x, serial_y), serial_img)

    return template



def sanitize_filename(s: str) -> str:
    return re.sub(r'[^A-Za-z0-9._-]+', '_', s)


def main():
    parser = argparse.ArgumentParser(description="Batch compile QR codes with labels")
    parser.add_argument(
        "--credentials", default=gdrive.DEFAULT_CREDENTIALS_FILE,
        help="Path to Google service account JSON key file"
    )
    parser.add_argument(
        "--sheet-url", default=gdrive.DEFAULT_SHEET_URL,
        help="Google Sheet URL"
    )
    parser.add_argument(
        "--sheet-name", default=gdrive.DEFAULT_SHEET_NAME,
        help="Worksheet name/tab"
    )
    parser.add_argument(
        "--template", dest="template",
        default=None,
        help="Path to template image (optional). If omitted, a white background of default size is used."
    )
    parser.add_argument(
        "--output-dir", default="package_qr_codes",
        help="Directory to save compiled images (default: package_qr_codes)"
    )
    parser.add_argument(
        "--box-size", type=int, default=10, help="QR code box size"
    )
    parser.add_argument(
        "--border", type=int, default=8, help="QR code border size (in boxes; increased default for better margins)"
    )
    parser.add_argument(
        "--cacao-logo", dest="cacao_logo",
        default=os.path.join(os.path.dirname(__file__), "agroverse_logo.jpeg"),
        help="Path to logo image for cacao items (default: agroverse_logo.jpg)"
    )
    parser.add_argument(
        "--non-cacao-logo", dest="non_cacao_logo",
        default=os.path.join(os.path.dirname(__file__), "truesight_icon.png"),
        help="Path to logo image for non-cacao items (default: truesight_icon.png)"
    )
    parser.add_argument(
        "--logo-ratio", dest="logo_ratio", type=float, default=0.2,
        help="Fraction of QR code size for logo (0<ratio<=1)"
    )
    parser.add_argument(
        "--no-logo", dest="no_logo", action="store_true",
        help="Disable embedding logo in QR code"
    )
    parser.add_argument(
        "--font-family", dest="font_family", default=DEFAULT_FONT_FAMILY,
        help="Font family to use for text (default: Helvetica)"
    )
    parser.add_argument(
        "--harvest-font-size", dest="harvest_font_size", type=int,
        default=DEFAULT_HARVEST_FONT_SIZE,
        help="Explicit font size in px for harvest/pledge line"
    )
    parser.add_argument(
        "--info-font-size", dest="info_font_size", type=int,
        default=DEFAULT_INFO_FONT_SIZE,
        help="Explicit font size in px for farm info line"
    )
    parser.add_argument(
        "--plant-font-size", dest="plant_font_size", type=int,
        default=DEFAULT_PLANT_FONT_SIZE,
        help="Explicit font size in px for plant line"
    )
    parser.add_argument(
        "--ignore-max-width", dest="ignore_max_width", action="store_true",
        help="Ignore auto-resizing text to fit width; use specified font sizes"
    )
    args = parser.parse_args()
    # If requested, disable logo embedding
    if getattr(args, 'no_logo', False):
        args.cacao_logo = None
        args.non_cacao_logo = None

    # Prepare output folder and to_print subdirectory
    os.makedirs(args.output_dir, exist_ok=True)
    to_print_dir = os.path.join(args.output_dir, "to_print")
    os.makedirs(to_print_dir, exist_ok=True)

    # Fetch rows: list of (qr_code, farm_name, state, country, year, is_cacao)
    rows = fetch_rows(args.credentials, args.sheet_url, args.sheet_name)
    for qr_code, farm_name, state, country, year, is_cacao in rows:
        # Determine output filename and path (prefixed with 'compiled_')
        filename = sanitize_filename(f"compiled_{farm_name}_{qr_code}.png")
        out_path = os.path.join(args.output_dir, filename)
        
        # Check if file already exists
        if os.path.exists(out_path):
            print(f"Image already exists, skipping: {out_path}")
            continue        

        # Select logo based on item type
        logo_path = args.cacao_logo if is_cacao else args.non_cacao_logo

        # Generate QR and compile image
        url = gdrive.BASE_QR_CHECK_URL + qr_code
        qr_img = generate_qr_image(
            url,
            box_size=args.box_size,
            border=args.border,
            logo_path=logo_path,
            logo_ratio=args.logo_ratio,
        )
        compiled = compile_image(
            args.template,
            qr_img,
            farm_name,
            state,
            country,
            year,
            qr_code,
            is_cacao,
            font_family=args.font_family,
            harvest_font_size=args.harvest_font_size,
            info_font_size=args.info_font_size,
            plant_font_size=args.plant_font_size,
            ignore_max_width=args.ignore_max_width,
        )
        # Save the compiled image to main output directory
        compiled.save(out_path)
        print(f"Saved compiled image: {out_path}")
        # Save a copy to to_print directory for new images
        to_print_path = os.path.join(to_print_dir, filename)
        compiled.save(to_print_path)
        print(f"Saved copy to print: {to_print_path}")


if __name__ == "__main__":
    main()