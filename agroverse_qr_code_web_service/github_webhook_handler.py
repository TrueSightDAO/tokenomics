#!/usr/bin/env python3
"""
GitHub Actions Webhook Handler for QR Code Generation

This script can be triggered by GitHub Actions webhooks to:
1. Generate QR code images from product data
2. Upload them to GitHub repository
3. Complete the QR code generation workflow

Usage:
- Can be triggered by repository_dispatch events
- Can be triggered by workflow_dispatch events
- Can be triggered by external webhooks
"""

import argparse
import json
import os
import sys
import requests
import subprocess
from datetime import datetime
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image, ImageDraw, ImageFont

# Configuration
# Try to load local config first, then fall back to environment variables
try:
    from local_config import GITHUB_TOKEN as LOCAL_GITHUB_TOKEN
    GITHUB_TOKEN = LOCAL_GITHUB_TOKEN
except ImportError:
    GITHUB_TOKEN = os.environ.get('QR_CODE_REPOSITORY_TOKEN')

GITHUB_REPOSITORY = 'TrueSightDAO/qr_codes'
# Use to_upload directory for temporary file storage
GITHUB_WORKSPACE = os.path.join(os.getcwd(), 'to_upload')

# PRODUCTION: Google Sheets configuration
# SHEET_URL = "https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1552160318#gid=1552160318"

# SANDBOX: Google Sheets configuration
SHEET_URL = "https://docs.google.com/spreadsheets/d/1qSi_-VSj7yiJl0Ak-Q3lch-l4mrH37cEw8EmQwS_6a4/edit?gid=472328231#gid=472328231"

CURRENCIES_SHEET_NAME = "Currencies"
QR_CODES_SHEET_NAME = "Agroverse QR codes"

def extract_sheet_id(sheet_url: str) -> str:
    """Extract sheet ID from Google Sheets URL"""
    import re
    match = re.search(r'/d/([a-zA-Z0-9-_]+)', sheet_url)
    if not match:
        raise ValueError(f"Could not parse spreadsheet ID from URL: {sheet_url}")
    return match.group(1)

def parse_github_url(github_url: str):
    """Parse GitHub URL from column K to extract repository and path"""
    if not github_url:
        return None, None
    
    # Expected format: https://github.com/TrueSightDAO/qr_codes/blob/main/[filename].png
    # or: https://raw.githubusercontent.com/TrueSightDAO/qr_codes/main/[filename].png
    
    try:
        if 'github.com' in github_url and '/blob/' in github_url:
            # Format: https://github.com/owner/repo/blob/branch/path
            parts = github_url.split('/')
            if len(parts) >= 6:
                owner = parts[3]
                repo = parts[4]
                branch = parts[6]
                path_parts = parts[7:]
                path = '/'.join(path_parts)
                return f"{owner}/{repo}", path
        elif 'raw.githubusercontent.com' in github_url:
            # Format: https://raw.githubusercontent.com/owner/repo/branch/path
            parts = github_url.split('/')
            if len(parts) >= 6:
                owner = parts[3]
                repo = parts[4]
                branch = parts[5]
                path_parts = parts[6:]
                path = '/'.join(path_parts)
                return f"{owner}/{repo}", path
    except Exception as e:
        print(f"Warning: Could not parse GitHub URL '{github_url}': {e}")
    
    return None, None

def fetch_sheet_row(row_number: int):
    """Fetch data from a specific row in the Agroverse QR codes sheet"""
    try:
        # Try to import Google Sheets API
        try:
            from googleapiclient.discovery import build
            from google.oauth2 import service_account
        except ImportError:
            print("❌ Google Sheets API not available. Install with: pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib")
            return None
        
        # Check for credentials - try environment variable first (GitHub Actions), then file
        credentials = None
        
        # Try environment variable first (for GitHub Actions)
        gdrive_key_json = os.environ.get('GDRIVE_KEY')
        if gdrive_key_json:
            try:
                import json
                credentials_data = json.loads(gdrive_key_json)
                credentials = service_account.Credentials.from_service_account_info(
                    credentials_data,
                    scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
                )
                print("✅ Using Google Sheets credentials from environment variable")
            except Exception as e:
                print(f"⚠️ Failed to parse GDRIVE_KEY environment variable: {e}")
        
        # Fallback to file if environment variable not available
        if not credentials:
            try:
                from local_config import GOOGLE_SHEETS_CREDENTIALS_PATH
                credentials_path = os.path.join(os.path.dirname(__file__), GOOGLE_SHEETS_CREDENTIALS_PATH)
            except ImportError:
                # Fallback to default path
                credentials_path = os.path.join(os.path.dirname(__file__), "..", "python_scripts", "agroverse_qr_code_generator", "gdrive_key.json")
            
            if not os.path.exists(credentials_path):
                print(f"❌ Google Sheets credentials not found at: {credentials_path}")
                print("💡 For GitHub Actions, set GDRIVE_KEY environment variable")
                return None
            
            # Setup credentials from file
            credentials = service_account.Credentials.from_service_account_file(
                credentials_path,
                scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
            )
            print("✅ Using Google Sheets credentials from file")
        
        # Build service
        service = build('sheets', 'v4', credentials=credentials)
        
        # Extract sheet ID
        sheet_id = extract_sheet_id(SHEET_URL)
        
        # Read the specific row from Agroverse QR codes sheet (columns A-T)
        range_name = f"'{QR_CODES_SHEET_NAME}'!A{row_number}:T{row_number}"
        
        result = service.spreadsheets().values().get(
            spreadsheetId=sheet_id, 
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        if not values or not values[0]:
            print(f"❌ No data found in row {row_number}")
            return None
        
        row = values[0]
        
        # Extract data from Agroverse QR codes sheet (columns A-T)
        qr_code_value = row[0].strip() if len(row) > 0 else ""  # Column A: QR Code value
        landing_page = row[1].strip() if len(row) > 1 else ""   # Column B: Landing page
        ledger = row[2].strip() if len(row) > 2 else ""         # Column C: Ledger
        status = row[3].strip() if len(row) > 3 else ""         # Column D: Status (MINTED)
        farm_name = row[4].strip() if len(row) > 4 else ""      # Column E: Farm name
        state = row[5].strip() if len(row) > 5 else ""          # Column F: State
        country = row[6].strip() if len(row) > 6 else ""        # Column G: Country
        year = row[7].strip() if len(row) > 7 else ""           # Column H: Year
        product_name = row[8].strip() if len(row) > 8 else ""   # Column I: Product name
        date_created = row[9].strip() if len(row) > 9 else ""   # Column J: Date created
        github_url = row[10].strip() if len(row) > 10 else ""   # Column K: GitHub URL
        product_image = row[15].strip() if len(row) > 15 else "" # Column P: Product image
        price = row[19].strip() if len(row) > 19 else ""        # Column T: Price
        

        
        # Determine if item is cacao based on landing page
        is_cacao = landing_page.startswith('https://www.agroverse.shop')
        
        return {
            'qr_code_value': qr_code_value,
            'landing_page': landing_page,
            'ledger': ledger,
            'status': status,
            'farm_name': farm_name,
            'state': state,
            'country': country,
            'year': year,
            'product_name': product_name,
            'date_created': date_created,
            'github_url': github_url,
            'product_image': product_image,
            'price': price,
            'is_cacao': is_cacao
        }
        
    except Exception as e:
        print(f"❌ Error fetching sheet data: {e}")
        return None

class GitHubWebhookHandler:
    def __init__(self, github_token=None):
        self.github_token = github_token or GITHUB_TOKEN
        self.workspace = GITHUB_WORKSPACE
        
        # Ensure to_upload directory exists
        os.makedirs(self.workspace, exist_ok=True)
        
        # Install fonts for GitHub Actions environment
        self.install_fonts()
        
    def install_fonts(self):
        """Install fonts for GitHub Actions environment"""
        try:
            # Check if we're in a GitHub Actions environment
            if os.environ.get('GITHUB_ACTIONS'):
                self.log("🔧 Installing fonts for GitHub Actions environment...")
                
                # Install DejaVu fonts (common in Linux environments)
                try:
                    import subprocess
                    subprocess.run(['apt-get', 'update'], check=True, capture_output=True)
                    subprocess.run(['apt-get', 'install', '-y', 'fonts-dejavu-core'], check=True, capture_output=True)
                    self.log("✅ DejaVu fonts installed successfully")
                except Exception as e:
                    self.log(f"⚠️ Could not install DejaVu fonts: {e}")
                
                # Install Liberation fonts as alternative
                try:
                    subprocess.run(['apt-get', 'install', '-y', 'fonts-liberation'], check=True, capture_output=True)
                    self.log("✅ Liberation fonts installed successfully")
                except Exception as e:
                    self.log(f"⚠️ Could not install Liberation fonts: {e}")
                    
        except Exception as e:
            self.log(f"⚠️ Font installation failed: {e}")
            self.log("🔄 Continuing with default fonts...")
    
    def log(self, message):
        """Log message to GitHub Actions output"""
        print(f"[{datetime.now().isoformat()}] {message}")
        sys.stdout.flush()
    
    def generate_qr_code_value(self, product_name):
        """Generate QR code value from product name and current date"""
        today = datetime.now()
        date_str = today.strftime('%Y%m%d')
        year = today.year
        
        # Create a simple hash of the product name for uniqueness
        import hashlib
        product_hash = hashlib.md5(product_name.encode()).hexdigest()[:8]
        
        return f"{year}_{date_str}_{product_hash}"
    
    def create_qr_image(self, qr_code_value, output_path, farm_name=None, state=None, country=None, year=None, is_cacao=False):
        """Create QR code image with the same design as batch_compiler.py"""
        self.log(f"Creating QR code image: {qr_code_value}")
        
        # Layout and scaling constants (from batch_compiler.py)
        CANVAS_BASE_WIDTH = 450
        CANVAS_BASE_HEIGHT = 350
        CANVAS_SCALE = 1
        QR_BASE_SIZE = 320
        QR_RATIO = 0.5
        
        # Font size defaults
        DEFAULT_HARVEST_FONT_SIZE = 18
        DEFAULT_INFO_FONT_SIZE = 25
        DEFAULT_PLANT_FONT_SIZE = 20
        DEFAULT_SERIAL_FONT_SIZE = 22
        MIN_FONT_RATIO = 0.02
        MIN_FONT_SIZE = 6
        
        # Spacing ratios
        SIDE_MARGIN_RATIO = 0.05
        QR_TO_HARVEST_RATIO = 0.0001
        HARVEST_TO_INFO_RATIO = 0.10
        INFO_TO_PLANT_RATIO = 0.07
        BOTTOM_MARGIN_RATIO = 0.05
        RIGHT_MARGIN_SERIAL_RATIO = 0.05
        
        # Fixed positions (from batch_compiler.py)
        FIXED_QR_Y = -30
        FIXED_HARVEST_Y = 260
        FIXED_INFO_Y = 280
        FIXED_PLANT_Y = 310
        FIXED_SERIAL_Y = 325
        
        # Logo configuration
        LOGO_RATIO = 0.2
        
        # Try multiple paths for logo files (GitHub Actions environment)
        possible_cacao_logo_paths = [
            os.path.join(os.path.dirname(__file__), "agroverse_logo.jpeg"),
            os.path.join(os.path.dirname(__file__), "assets", "agroverse_logo.jpeg"),
            os.path.join(os.getcwd(), "agroverse_logo.jpeg"),
            os.path.join(os.getcwd(), "assets", "agroverse_logo.jpeg")
        ]
        
        possible_non_cacao_logo_paths = [
            os.path.join(os.path.dirname(__file__), "truesight_icon.png"),
            os.path.join(os.path.dirname(__file__), "assets", "truesight_icon.png"),
            os.path.join(os.getcwd(), "truesight_icon.png"),
            os.path.join(os.getcwd(), "assets", "truesight_icon.png")
        ]
        
        # Find the first available logo file
        logo_path = None
        if is_cacao:
            for path in possible_cacao_logo_paths:
                if os.path.exists(path):
                    logo_path = path
                    break
        else:
            for path in possible_non_cacao_logo_paths:
                if os.path.exists(path):
                    logo_path = path
                    break
        
        # Generate QR code with BASE_QR_CHECK_URL (from batch_compiler.py)
        BASE_QR_CHECK_URL = 'https://edgar.truesight.me/agroverse/qr-code-check?qr_code='
        qr_url = BASE_QR_CHECK_URL + qr_code_value
        
        qr = qrcode.QRCode(
            version=None,
            error_correction=ERROR_CORRECT_H,
            box_size=10,
            border=8,  # Increased border for better margins
        )
        qr.add_data(qr_url)
        qr.make(fit=True)
        
        qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
        
        # Embed logo if available
        if logo_path and os.path.exists(logo_path):
            try:
                logo = Image.open(logo_path).convert("RGBA")
                qr_w, qr_h = qr_img.size
                max_logo_size = int(min(qr_w, qr_h) * LOGO_RATIO)
                try:
                    resample = Image.Resampling.LANCZOS
                except AttributeError:
                    resample = Image.LANCZOS
                logo.thumbnail((max_logo_size, max_logo_size), resample)
                lw, lh = logo.size
                pos = ((qr_w - lw) // 2, (qr_h - lh) // 2)
                qr_img.paste(logo, pos, logo)
                self.log(f"✅ Embedded logo: {os.path.basename(logo_path)}")
            except Exception as e:
                self.log(f"⚠️ Warning: Could not embed logo: {e}")
                self.log(f"📁 Logo path attempted: {logo_path}")
        else:
            self.log(f"⚠️ Logo not found. Searched paths:")
            if is_cacao:
                for path in possible_cacao_logo_paths:
                    self.log(f"   - {path} {'✅' if os.path.exists(path) else '❌'}")
            else:
                for path in possible_non_cacao_logo_paths:
                    self.log(f"   - {path} {'✅' if os.path.exists(path) else '❌'}")
            self.log("🔄 Continuing without logo...")
        
        # Create canvas (white background)
        scale = CANVAS_SCALE
        bg_w = CANVAS_BASE_WIDTH * scale
        bg_h = CANVAS_BASE_HEIGHT * scale
        template = Image.new("RGBA", (bg_w, bg_h), (255, 255, 255, 255))
        
        # Resize QR code
        qr_size = QR_BASE_SIZE * scale
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:
            resample = Image.LANCZOS
        qr_img = qr_img.resize((qr_size, qr_size), resample)
        qr_w, qr_h = qr_img.size
        
        draw = ImageDraw.Draw(template)
        
        # Helper to measure text size
        def text_size(txt, fnt):
            if hasattr(draw, 'textbbox'):
                bbox = draw.textbbox((0, 0), txt, font=fnt)
                return bbox[2] - bbox[0], bbox[3] - bbox[1]
            else:
                mask = fnt.getmask(txt)
                return mask.size
        
        # Helper to load font
        def load_font(size):
            # Try local font files first (bundled with the code)
            local_fonts = [
                'arial.ttf',  # Local Arial font
                'arial_bold.ttf',  # Local Arial Bold font
            ]
            
            # Try system fonts as fallback
            system_fonts = [
                '/System/Library/Fonts/ArialHB.ttc',  # macOS Arial
                '/System/Library/Fonts/Courier.ttc',  # macOS Courier
                '/System/Library/Fonts/Helvetica.ttc',  # macOS Helvetica
                '/System/Library/Fonts/HelveticaNeue.ttc',  # macOS Helvetica Neue
                '/System/Library/Fonts/Times.ttc',  # macOS Times
                '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',  # Linux DejaVu
                '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',  # Linux Liberation
                '/usr/share/fonts/TTF/arial.ttf',  # Linux Arial
                '/usr/share/fonts/TTF/courier.ttf',  # Linux Courier
            ]
            
            self.log(f"🔤 Attempting to load font with size {size}")
            
            # Try local fonts first
            for font_path in local_fonts:
                try:
                    if os.path.exists(font_path):
                        self.log(f"✅ Found local font: {font_path}")
                        font = ImageFont.truetype(font_path, size)
                        self.log(f"✅ Successfully loaded local font: {font_path} with size {size}")
                        return font
                except Exception as e:
                    self.log(f"❌ Failed to load local font {font_path}: {e}")
                    continue
            
            # Try system fonts as fallback
            for font_path in system_fonts:
                try:
                    if os.path.exists(font_path):
                        self.log(f"✅ Found system font: {font_path}")
                        font = ImageFont.truetype(font_path, size)
                        self.log(f"✅ Successfully loaded system font: {font_path} with size {size}")
                        return font
                except Exception as e:
                    self.log(f"❌ Failed to load system font {font_path}: {e}")
                    continue
            
            # Fallback to default font (works in GitHub Actions)
            try:
                self.log("🔄 Falling back to default font")
                default_font = ImageFont.load_default()
                self.log("✅ Successfully loaded default font")
                return default_font
            except Exception as e:
                self.log(f"❌ Failed to load default font: {e}")
                # Ultimate fallback - create a basic font
                return None
        
        # Prepare text lines (matching batch_compiler.py logic)
        if is_cacao:
            harvest_text = f"Harvest {year}" if year else "Pledge Confirmed"
        else:
            harvest_text = f"Restoring Rainforest since {year}" if year else "Restoring Rainforest"
        
        info_parts = [farm_name] if farm_name else []
        if state:
            info_parts.append(state)
        if country:
            info_parts.append(country)
        info_text = ", ".join(info_parts) if info_parts else "Agroverse Farm"
        
        plant_text = "Your tree is getting planted"
        serial_text = qr_code_value  # This should be the QR code value from column A
        
        # Determine fonts and spacing
        side_margin = int(bg_w * SIDE_MARGIN_RATIO)
        right_margin_serial = int(bg_w * RIGHT_MARGIN_SERIAL_RATIO)
        min_font = max(MIN_FONT_SIZE, int(bg_h * MIN_FONT_RATIO))
        
        # Set font sizes
        f_harvest_size = max(min_font, DEFAULT_HARVEST_FONT_SIZE)
        f_info_size = max(min_font, DEFAULT_INFO_FONT_SIZE)
        f_plant_size = max(min_font, DEFAULT_PLANT_FONT_SIZE)
        f_serial_size = max(min_font, DEFAULT_SERIAL_FONT_SIZE)
        
        # Load fonts
        f_harvest = load_font(f_harvest_size)
        f_info = load_font(f_info_size)
        f_plant = load_font(f_plant_size)
        f_serial = load_font(f_serial_size)
        
        # Ensure we have valid fonts (fallback to default if needed)
        if f_harvest is None:
            self.log("⚠️ Harvest font is None, using default")
            f_harvest = ImageFont.load_default()
        if f_info is None:
            self.log("⚠️ Info font is None, using default")
            f_info = ImageFont.load_default()
        if f_plant is None:
            self.log("⚠️ Plant font is None, using default")
            f_plant = ImageFont.load_default()
        if f_serial is None:
            self.log("⚠️ Serial font is None, using default")
            f_serial = ImageFont.load_default()
        
        self.log(f"📝 Fonts loaded - Harvest: {type(f_harvest)}, Info: {type(f_info)}, Plant: {type(f_plant)}, Serial: {type(f_serial)}")
        
        # Measure text heights
        _, h1 = text_size(harvest_text, f_harvest)
        _, h2 = text_size(info_text, f_info)
        _, h3 = text_size(plant_text, f_plant)
        w_serial, h_serial = text_size(serial_text, f_serial)
        
        # Vertical spacing
        m1 = int(bg_h * QR_TO_HARVEST_RATIO)
        m2 = int(bg_h * HARVEST_TO_INFO_RATIO)
        m3 = int(bg_h * INFO_TO_PLANT_RATIO)
        bottom_margin = int(bg_h * BOTTOM_MARGIN_RATIO)
        
        # Compute dynamic starting Y
        total_h = qr_h + m1 + h1 + m2 + h2 + m3 + h3
        dynamic_start_y = bg_h - bottom_margin - total_h
        
        # Paste QR code (centered horizontally)
        qr_x = (bg_w - qr_w) // 2
        qr_y = FIXED_QR_Y if FIXED_QR_Y is not None else dynamic_start_y
        template.paste(qr_img, (qr_x, qr_y), qr_img)
        
        # Determine Y positions for text
        harvest_y = FIXED_HARVEST_Y if FIXED_HARVEST_Y is not None else qr_y + qr_h + m1
        info_y = FIXED_INFO_Y if FIXED_INFO_Y is not None else harvest_y + h1 + m2
        plant_y = FIXED_PLANT_Y if FIXED_PLANT_Y is not None else info_y + h2 + m3
        
        # Draw harvest text (centered horizontally)
        w_harvest, _ = text_size(harvest_text, f_harvest)
        x = (bg_w - w_harvest) // 2
        self.log(f"🎨 Drawing harvest text: '{harvest_text}' at ({x}, {harvest_y}) with font {type(f_harvest)}")
        draw.text((x, harvest_y), harvest_text, fill="black", font=f_harvest)
        
        # Draw info text (centered horizontally)
        w_info, _ = text_size(info_text, f_info)
        x = (bg_w - w_info) // 2
        self.log(f"🎨 Drawing info text: '{info_text}' at ({x}, {info_y}) with font {type(f_info)}")
        draw.text((x, info_y), info_text, fill="black", font=f_info)
        
        # Draw planting message (centered horizontally)
        w_plant, _ = text_size(plant_text, f_plant)
        x = (bg_w - w_plant) // 2
        self.log(f"🎨 Drawing plant text: '{plant_text}' at ({x}, {plant_y}) with font {type(f_plant)}")
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
        
        # Save the compiled image
        template.save(output_path)
        self.log(f"QR code image saved to: {output_path}")
        return output_path
    
    def setup_git(self):
        """Configure git for GitHub Actions (no longer needed with API approach)"""
        self.log("Git setup not needed - using GitHub API directly")
        pass
    
    def upload_to_github(self, qr_code_value, qr_image_path, commit_message=None, target_repo=None, target_path=None):
        """Upload QR code image to GitHub using API"""
        if not commit_message:
            commit_message = f"Add QR code: {qr_code_value} [skip ci]"
        
        self.log(f"Uploading QR code to GitHub: {qr_code_value}")
        
        # Verify the file exists
        if not os.path.exists(qr_image_path):
            raise FileNotFoundError(f"QR code image not found at: {qr_image_path}")
        
        # Read the file and encode to base64
        with open(qr_image_path, 'rb') as f:
            file_content = f.read()
        
        import base64
        base64_content = base64.b64encode(file_content).decode('utf-8')
        
        # Use target repository and path if provided, otherwise use defaults
        repo = target_repo or GITHUB_REPOSITORY
        path = target_path or f"{qr_code_value}.png"
        api_url = f"https://api.github.com/repos/{repo}/contents/{path}"
        
        # Prepare payload
        payload = {
            "message": commit_message,
            "content": base64_content
        }
        
        # Prepare headers
        headers = {
            "Authorization": f"token {self.github_token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        }
        
        # Make the API request
        response = requests.put(api_url, json=payload, headers=headers)
        
        # Handle file conflict (422 error means file already exists or other validation error)
        if response.status_code == 422:
            try:
                error_data = response.json()
                error_message = error_data.get("message", "").lower()
                
                # Check for various file conflict indicators
                if any(phrase in error_message for phrase in ["already exists", "sha wasn't supplied", "invalid request"]):
                    self.log(f"⚠️ File {qr_code_value}.png already exists on GitHub")
                    self.log("🔄 Overriding existing file...")
                    
                    # Get the SHA of the existing file to update it
                    get_url = f"https://api.github.com/repos/{repo}/contents/{path}"
                    get_response = requests.get(get_url, headers=headers)
                    
                    if get_response.status_code == 200:
                        existing_file_data = get_response.json()
                        sha = existing_file_data.get('sha')
                        
                        if sha:
                            # Update the existing file
                            payload["sha"] = sha
                            payload["message"] = f"Update QR code: {qr_code_value} [skip ci]"
                            
                            # Retry the upload with SHA
                            update_response = requests.put(api_url, json=payload, headers=headers)
                            
                            if update_response.status_code in [200, 201]:
                                update_data = update_response.json()
                                raw_url = f"https://raw.githubusercontent.com/{repo}/main/{path}"
                                commit_url = update_data['commit']['html_url']
                                
                                self.log(f"✅ Successfully updated {qr_code_value}.png on GitHub")
                                self.log(f"Repository: {repo}")
                                self.log(f"Path: {path}")
                                self.log(f"Raw URL: {raw_url}")
                                self.log(f"Commit URL: {commit_url}")
                                
                                return {
                                    'raw_url': raw_url,
                                    'commit_url': commit_url,
                                    'repository': repo,
                                    'path': path
                                }
                            else:
                                error_msg = f"Failed to update file on GitHub: {update_response.status_code} - {update_response.text}"
                                self.log(f"ERROR: {error_msg}")
                                raise Exception(error_msg)
                        else:
                            error_msg = "Could not get SHA of existing file"
                            self.log(f"ERROR: {error_msg}")
                            raise Exception(error_msg)
                    else:
                        error_msg = f"Could not get existing file info: {get_response.status_code} - {get_response.text}"
                        self.log(f"ERROR: {error_msg}")
                        raise Exception(error_msg)
                    
                else:
                    # Other 422 error, raise exception
                    error_msg = f"Failed to upload to GitHub: {response.status_code} - {response.text}"
                    self.log(f"ERROR: {error_msg}")
                    raise Exception(error_msg)
                    
            except Exception as e:
                # If we can't parse the error or handle it, log and continue
                self.log(f"⚠️ File conflict detected but couldn't resolve: {e}")
                self.log("📝 QR code image was created locally but not uploaded to GitHub")
                return {
                    'raw_url': None,
                    'commit_url': None,
                    'warning': f"File {qr_code_value}.png already exists on GitHub. Local file saved as {qr_image_path}"
                }
        
        elif response.status_code not in [200, 201]:
            error_msg = f"Failed to upload to GitHub: {response.status_code} - {response.text}"
            self.log(f"ERROR: {error_msg}")
            raise Exception(error_msg)
        
        response_data = response.json()
        
        if not response_data.get('content'):
            raise Exception(f"Failed to upload to GitHub: {response.text}")
        
        # Return URLs
        raw_url = f"https://raw.githubusercontent.com/{repo}/main/{path}"
        commit_url = response_data['commit']['html_url']
        
        self.log(f"✅ Successfully uploaded {qr_code_value}.png to GitHub")
        self.log(f"Repository: {repo}")
        self.log(f"Path: {path}")
        self.log(f"Raw URL: {raw_url}")
        self.log(f"Commit URL: {commit_url}")
        
        return {
            'raw_url': raw_url,
            'commit_url': commit_url,
            'repository': repo,
            'path': path
        }
    
    def handle_webhook_request(self, product_name, landing_page_url=None, farm_name=None, state=None, country=None, year=None, is_cacao=False, auto_commit=True, sheet_data=None):
        """Handle webhook request for QR code generation"""
        self.log(f"Starting QR code generation for product: {product_name}")
        
        try:
            # Step 1: Get QR code value from sheet data or generate one
            self.log("Step 1: Getting QR code value...")
            if sheet_data and sheet_data.get('qr_code_value'):
                # Use QR code value from sheet data (column A)
                qr_code_value = sheet_data['qr_code_value']
                self.log(f"Using QR code value from sheet: {qr_code_value}")
            else:
                # Generate QR code value (fallback)
                qr_code_value = self.generate_qr_code_value(product_name)
                self.log(f"Generated QR code value: {qr_code_value}")
            
            # Use provided landing page URL or create a default one
            if not landing_page_url:
                landing_page_url = f"https://agroverse.com/product/{qr_code_value}"
            
            self.log(f"QR code value: {qr_code_value}")
            self.log(f"Landing page: {landing_page_url}")
            self.log(f"Farm info: {farm_name}, {state}, {country}, {year}")
            self.log(f"Product type: {'Cacao' if is_cacao else 'Non-cacao'}")
            
            # Step 2: Setup git
            self.log("Step 2: Setting up git...")
            self.setup_git()
            
            # Step 3: Create QR code image
            self.log("Step 3: Creating QR code image...")
            qr_image_path = os.path.join(self.workspace, f"{qr_code_value}.png")
            self.log(f"Creating QR code at path: {qr_image_path}")
            self.create_qr_image(qr_code_value, qr_image_path, farm_name, state, country, year, is_cacao)
            
            # Verify the file was created
            if os.path.exists(qr_image_path):
                self.log(f"✅ QR code image created successfully at: {qr_image_path}")
                self.log(f"File size: {os.path.getsize(qr_image_path)} bytes")
            else:
                raise FileNotFoundError(f"QR code image was not created at: {qr_image_path}")
            
            # Step 4: Upload to GitHub
            if auto_commit:
                self.log("Step 4: Uploading to GitHub...")
                commit_message = f"Add QR code for {product_name}: {qr_code_value} [skip ci]"
                
                # Parse GitHub URL from sheet data if available
                target_repo = None
                target_path = None
                if sheet_data and sheet_data.get('github_url'):
                    target_repo, target_path = parse_github_url(sheet_data['github_url'])
                    if target_repo and target_path:
                        self.log(f"📁 Using target repository: {target_repo}")
                        self.log(f"📁 Using target path: {target_path}")
                    else:
                        self.log("⚠️ Could not parse GitHub URL from sheet, using defaults")
                
                upload_result = self.upload_to_github(qr_code_value, qr_image_path, commit_message, target_repo, target_path)
            
            # Return success result
            result = {
                'success': True,
                'product_name': product_name,
                'qr_code': qr_code_value,
                'github_url': f"https://github.com/{GITHUB_REPOSITORY}/blob/main/{qr_code_value}.png",
                'local_image_path': qr_image_path,
                'landing_page': landing_page_url,
                'farm_name': farm_name,
                'state': state,
                'country': country,
                'year': year,
                'timestamp': datetime.now().isoformat()
            }
            
            # Add upload information if auto_commit was enabled
            if auto_commit:
                result.update({
                    'raw_url': upload_result.get('raw_url'),
                    'commit_url': upload_result.get('commit_url')
                })
                
                # Handle warning if file already existed
                if upload_result.get('warning'):
                    result['warning'] = upload_result['warning']
            
            self.log("QR code generation completed successfully!")
            return result
            
        except Exception as e:
            error_msg = f"Error during QR code generation: {str(e)}"
            self.log(f"ERROR: {error_msg}")
            return {
                'success': False,
                'error': error_msg,
                'product_name': product_name,
                'timestamp': datetime.now().isoformat()
            }

def main():
    parser = argparse.ArgumentParser(description="GitHub Actions Webhook Handler for QR Code Generation")
    parser.add_argument("--sheet-row", type=int, help="Row number from Agroverse QR codes sheet to fetch data from")
    parser.add_argument("--product-name", help="Product name to generate QR code for (alternative to sheet-row)")
    parser.add_argument("--landing-page-url", help="Landing page URL for the QR code")
    parser.add_argument("--farm-name", help="Farm name for the QR code")
    parser.add_argument("--state", help="State for the QR code")
    parser.add_argument("--country", help="Country for the QR code")
    parser.add_argument("--year", help="Year for the QR code")
    parser.add_argument("--is-cacao", action="store_true", help="Mark as cacao product (uses agroverse logo)")
    parser.add_argument("--github-token", help="GitHub personal access token")
    parser.add_argument("--no-commit", action="store_true", help="Don't commit to GitHub")
    parser.add_argument("--output-file", help="Output file for results (JSON)")
    
    args = parser.parse_args()
    
    # Initialize handler
    handler = GitHubWebhookHandler(github_token=args.github_token)
    
    try:
        # Validate that either sheet_row or product_name is provided
        if not args.sheet_row and not args.product_name:
            raise ValueError("Either --sheet-row or --product-name must be provided")
        
        # If sheet_row is provided, fetch data from sheet and use it
        sheet_data = None
        if args.sheet_row:
            sheet_data = fetch_sheet_row(args.sheet_row)
            if not sheet_data:
                raise ValueError(f"No data found for sheet row {args.sheet_row}")
            
            # Use data from sheet
            product_name = sheet_data['product_name']
            landing_page_url = sheet_data['landing_page']
            farm_name = sheet_data['farm_name']
            state = sheet_data['state']
            country = sheet_data['country']
            year = sheet_data['year']
            is_cacao = sheet_data['is_cacao']
        else:
            # Use provided parameters
            product_name = args.product_name
            landing_page_url = args.landing_page_url
            farm_name = args.farm_name
            state = args.state
            country = args.country
            year = args.year
            is_cacao = args.is_cacao
        
        # Handle the webhook request
        result = handler.handle_webhook_request(
            product_name,
            landing_page_url=landing_page_url,
            farm_name=farm_name,
            state=state,
            country=country,
            year=year,
            is_cacao=is_cacao,
            auto_commit=not args.no_commit,
            sheet_data=sheet_data
        )
        
        # Output results
        if args.output_file:
            with open(args.output_file, 'w') as f:
                json.dump(result, f, indent=2)
            handler.log(f"Results saved to: {args.output_file}")
        
        # Print results to stdout for GitHub Actions
        print(json.dumps(result, indent=2))
        
        # Exit with appropriate code
        if result['success']:
            sys.exit(0)
        else:
            sys.exit(1)
            
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'product_name': args.product_name or f"sheet_row_{args.sheet_row}" if args.sheet_row else "unknown",
            'timestamp': datetime.now().isoformat()
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)

def test_qr_generation(product_name=None, farm_name=None, state=None, country=None, year=None, landing_page_url=None, is_cacao=None, sheet_row=None):
    """Test method to generate QR code locally and upload to GitHub"""
    print("🧪 Testing QR Code Generation...")
    
    # If sheet_row is provided, fetch data from Agroverse QR codes sheet
    if sheet_row is not None:
        print(f"📊 Fetching data from Agroverse QR codes sheet row {sheet_row}...")
        try:
            sheet_data = fetch_sheet_row(sheet_row)
            if sheet_data:
                test_product_name = sheet_data['product_name']
                test_farm_name = sheet_data['farm_name']
                test_state = sheet_data['state']
                test_country = sheet_data['country']
                test_year = sheet_data['year']
                test_landing_page_url = sheet_data['landing_page']
                test_is_cacao = sheet_data['is_cacao']
                
                # Display fetched data for verification
                print(f"✅ Successfully fetched data from row {sheet_row}")
                print(f"📱 QR Code: {sheet_data['qr_code_value']}")
                print(f"📝 Product: {test_product_name}")
                print(f"🏡 Farm: {test_farm_name}, {test_state}, {test_country}")
                print(f"📅 Year: {test_year}")
                print(f"🔗 Landing Page: {test_landing_page_url}")
                print(f"💰 Price: {sheet_data['price']}")
                print(f"🏷️ Status: {sheet_data['status']}")
            else:
                print(f"❌ No data found for row {sheet_row}")
                return
        except Exception as e:
            print(f"❌ Error fetching data from row {sheet_row}: {e}")
            return
    else:
        # Test parameters (use provided values or defaults)
        test_product_name = product_name or "Caramelized Cacao Kraft Pouch - Alibaba:269035810001023771 + Caramelized Cacao Beans CP340993299BR San Francisco AGL10"
        test_farm_name = farm_name or "San Francisco AGL10"
        test_state = state or "California"
        test_country = country or "USA"
        test_year = year or "2024"
        test_landing_page_url = landing_page_url or "https://agroverse.com/product/test"
        test_is_cacao = is_cacao if is_cacao is not None else True  # Default to cacao for test
    
    # Initialize handler
    handler = GitHubWebhookHandler()
    
    try:
        print(f"📝 Product: {test_product_name}")
        print(f"🏡 Farm: {test_farm_name}, {test_state}, {test_country}")
        print(f"📅 Year: {test_year}")
        print(f"🔗 Landing Page: {test_landing_page_url}")
        
        # Generate QR code
        if sheet_row is not None and sheet_data:
            # Use sheet data
            result = handler.handle_webhook_request(
                product_name=test_product_name,
                farm_name=test_farm_name,
                state=test_state,
                country=test_country,
                year=test_year,
                is_cacao=test_is_cacao,
                auto_commit=True,
                sheet_data=sheet_data
            )
        else:
            # Use provided parameters
            result = handler.handle_webhook_request(
                product_name=test_product_name,
                landing_page_url=test_landing_page_url,
                farm_name=test_farm_name,
                state=test_state,
                country=test_country,
                year=test_year,
                is_cacao=test_is_cacao,
                auto_commit=True
            )
        
        if result['success']:
            print("\n✅ Test completed successfully!")
            print(f"📱 QR Code: {result['qr_code']}")
            print(f"🖼️  Local Image: {result['local_image_path']}")
            print(f"🌐 GitHub URL: {result['github_url']}")
            print(f"📎 Raw URL: {result.get('raw_url', 'N/A')}")
            print(f"🔗 Commit URL: {result.get('commit_url', 'N/A')}")
            
            # Check if file exists locally
            if os.path.exists(result['local_image_path']):
                file_size = os.path.getsize(result['local_image_path'])
                print(f"📊 File Size: {file_size} bytes")
                print(f"📁 File exists locally: ✅")
                print(f"📂 Location: {result['local_image_path']}")
                
                # Try to open the image automatically
                try:
                    import subprocess
                    import platform
                    
                    system = platform.system()
                    if system == "Darwin":  # macOS
                        subprocess.run(["open", result['local_image_path']])
                        print(f"🖼️  Opened image with default app")
                    elif system == "Windows":
                        subprocess.run(["start", result['local_image_path']], shell=True)
                        print(f"🖼️  Opened image with default app")
                    elif system == "Linux":
                        subprocess.run(["xdg-open", result['local_image_path']])
                        print(f"🖼️  Opened image with default app")
                    else:
                        print(f"🖼️  Image saved at: {result['local_image_path']}")
                except Exception as e:
                    print(f"🖼️  Image saved at: {result['local_image_path']} (could not auto-open: {e})")
            else:
                print(f"❌ File not found locally: {result['local_image_path']}")
                
        else:
            print(f"\n❌ Test failed: {result.get('error', 'Unknown error')}")
            
    except Exception as e:
        print(f"\n💥 Test error: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    import sys
    
    # Check if test mode is requested
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        # Parse test parameters if provided
        test_params = {}
        for i, arg in enumerate(sys.argv[2:], 2):
            if arg.startswith("--"):
                if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("--"):
                    test_params[arg[2:]] = sys.argv[i + 1]
                else:
                    test_params[arg[2:]] = True
        
        test_qr_generation(
            product_name=test_params.get('product-name'),
            farm_name=test_params.get('farm-name'),
            state=test_params.get('state'),
            country=test_params.get('country'),
            year=test_params.get('year'),
            landing_page_url=test_params.get('landing-page-url'),
            sheet_row=test_params.get('sheet-row')
        )
    else:
        main()
