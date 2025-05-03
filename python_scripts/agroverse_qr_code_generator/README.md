# Agroverse QR Code Generator

Generate a QR code for any URL, with optional logo embedding at the center.

## Prerequisites

- Python 3.x
- Install dependencies:
  ```bash
  pip install qrcode[pil]
  ```
  This will also pull in Pillow for image handling.

## Usage

Change into the script directory:
```bash
cd python_scripts/agroverse_qr_code
```

Run the generator:
```bash
python agroverse_qr_code_generator.py [URL] [options]
```

### Positional Arguments
- `URL`  (optional): the link or text to encode. Defaults to the Instagram post URL.

### Options
- `-o, --output`    Output PNG filename (default: `qr.png`)
- `-s, --size`      Box size (pixels) for each QR module (default: 10)
- `-b, --border`    Border width (modules) around the code (default: 4)
- `--logo`          Path to a logo image to embed at the center
- `--logo-ratio`    Fraction of the QR size for the logo (0 < ratio ≤ 1; default: 0.2)

## Examples

Generate a simple QR:
```bash
python generator.py \
  "https://www.agroverse.shop/cacao-circles" \
  -o package_qr_codes/cacao_circles.png
```



Generate a QR with a centered logo for visiting Fazenda page for this specific bag of cacao:
```bash
python generator.py \
  --url 'https://edgar.truesight.me/agroverse/qr-code-check?qr_code=HAPPY_BAG' \
  --output package_qr_codes/paulo_fazenda_serialized_tracking_happy.png \
  --logo ./agroverse_logo.jpg \
  --logo-ratio 0.25
```

```bash
python generator.py \
  --url 'https://edgar.truesight.me/agroverse/qr-code-check?qr_code=MISSING_BAG' \
  --output package_qr_codes/paulo_fazenda_serialized_tracking_missing.png \
  --logo ./agroverse_logo.jpg \
  --logo-ratio 0.25
```


Generate a QR with a centered logo for visiting cacao circle page
```bash
python generator.py \
  --url https://www.agroverse.shop/cacao-circles \
  --output package_qr_codes/cacao_cirlces.png \
  --logo ./cacao_circles.jpg \
  --logo-ratio 0.25
```


---
_This script is provided as-is without warranty._