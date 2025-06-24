# Agroverse QR Code Generator

Generate a QR code for any URL, with optional logo embedding at the center.

## Prerequisites

- Python 3.x
- Install dependencies (from the local requirements file):
  ```bash
  pip install -r requirements.txt
  ```

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
  
## Google Sheets QR Codes Batch Fetch

To fetch QR codes in bulk from a Google Sheet, you will need a Google service account key file named `gdrive_key.json` in the project root (this file is ignored by Git via `.gitignore`). This file should contain your service account credentials in JSON format.

All Python dependencies (including Google API libraries) are listed in `requirements.txt`.
Install them with:

```bash
pip install -r requirements.txt
```

Use the helper class in `gdrive.py`:

```python
from gdrive import GDrive

# Loads credentials from gdrive_key.json by default
gd = GDrive()

urls = gd.list_qr_check_urls(
    "https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/",
    "Agroverse QR codes"
)
```

This will print and return a list of URLs in the form:
`https://edgar.truesight.me/agroverse/qr-code-check?qr_code=<QR_CODE>`

---
## Batch QR Code Compilation

Automate the generation of labeled QR code images by fetching serials and farm names
from your Google Sheet, embedding each QR into a template, and annotating it above
with the farm name and below with the serial number.

### Prerequisites
All dependencies are listed in `requirements.txt`. Install them with:
```bash
pip install -r requirements.txt
```
Ensure your Google service account key file `gdrive_key.json` is present in the project root.

### Usage
```bash
 python3 batch_compiler.py \
   --credentials gdrive_key.json \
   --sheet-url "https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/" \
   --sheet-name "Agroverse QR codes" \
   --output-dir package_qr_codes \
   --box-size 12 \
   --border 8 \
   --logo-ratio 0.25 \
   --font-family "/System/Library/Fonts/Helvetica.ttc"
```

Options:
- `--credentials`  Path to service account JSON file (default: `gdrive_key.json`)
- `--sheet-url`    Google Sheet URL (default as defined in `gdrive.py`)
- `--sheet-name`   Worksheet/tab name (default as defined in `gdrive.py`)
- `--template`     Template image for background (optional; omit to use white background)
- `--output-dir`   Directory to save compiled images (default: `package_qr_codes`)
- `--box-size`     QR code box size in pixels (default: 10)
- `--border`       QR code border width in boxes (default: 8)
- `--logo`         Path to logo image to embed at center of QR code (optional; default: `agroverse_logo.jpg`)
- `--logo-ratio`   Fraction of the QR code size for the logo (default: 0.2)
- `--no-logo`      Disable embedding logo in QR code
- `--font-family`  Font family to use for text (default: Helvetica)

Note: By default (no `--template`), the compiler outputs a 570×425 pixel image (5× the original 114×85), with the QR code fixed at 315×315 pixels (5× the original 63×63). Font sizes are dynamically chosen so that the Harvest, farm info, and planting message lines make good use of the 570px width. If you supply your own template, the output matches your template’s dimensions and the QR scales to 30% of its width.
Additionally:
- The farm info line (`Farm, State, Country`) is rendered at 30% larger font size (no bold).
- The planting message (`Your tree is getting planted`) is rendered at 20% larger font size.
- Vertical spacing between text lines has been slightly increased for readability.

Compiled images will be saved as `compiled_<farm_name>_<serial>.png` in the output directory.