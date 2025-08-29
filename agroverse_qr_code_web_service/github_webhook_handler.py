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
from PIL import Image

# Configuration
GITHUB_TOKEN = os.environ.get('QR_CODE_REPOSITORY_TOKEN')
GITHUB_REPOSITORY = 'TrueSightDAO/qr_codes'
# Use current directory for temporary file storage
GITHUB_WORKSPACE = os.getcwd()

class GitHubWebhookHandler:
    def __init__(self, github_token=None):
        self.github_token = github_token or GITHUB_TOKEN
        self.workspace = GITHUB_WORKSPACE
        
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
    
    def create_qr_image(self, qr_code_value, landing_page_url, output_path, farm_name=None, state=None, country=None, year=None):
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
        
        # Generate QR code
        qr = qrcode.QRCode(
            version=None,
            error_correction=ERROR_CORRECT_H,
            box_size=10,
            border=8,  # Increased border for better margins
        )
        qr.add_data(landing_page_url)
        qr.make(fit=True)
        
        qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
        
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
            try:
                return ImageFont.truetype('cour.ttf', size)  # Prefer Courier New
            except Exception:
                try:
                    return ImageFont.truetype('arial.ttf', size)
                except Exception:
                    try:
                        return ImageFont.truetype('Helvetica.ttc', size)
                    except Exception:
                        return ImageFont.load_default()
        
        # Prepare text lines
        harvest_text = f"Restoring Rainforest since {year}" if year else "Restoring Rainforest"
        
        info_parts = [farm_name] if farm_name else []
        if state:
            info_parts.append(state)
        if country:
            info_parts.append(country)
        info_text = ", ".join(info_parts) if info_parts else "Agroverse Farm"
        
        plant_text = "Your tree is getting planted"
        serial_text = qr_code_value
        
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
        draw.text((x, harvest_y), harvest_text, fill="black", font=f_harvest)
        
        # Draw info text (centered horizontally)
        w_info, _ = text_size(info_text, f_info)
        x = (bg_w - w_info) // 2
        draw.text((x, info_y), info_text, fill="black", font=f_info)
        
        # Draw planting message (centered horizontally)
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
        
        # Save the compiled image
        template.save(output_path)
        self.log(f"QR code image saved to: {output_path}")
        return output_path
    
    def setup_git(self):
        """Configure git for GitHub Actions (no longer needed with API approach)"""
        self.log("Git setup not needed - using GitHub API directly")
        pass
    
    def upload_to_github(self, qr_code_value, qr_image_path, commit_message=None):
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
        
        # GitHub API URL
        repo = GITHUB_REPOSITORY
        path = f"{qr_code_value}.png"
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
        
        if response.status_code not in [200, 201]:
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
        self.log(f"Raw URL: {raw_url}")
        self.log(f"Commit URL: {commit_url}")
        
        return {
            'raw_url': raw_url,
            'commit_url': commit_url
        }
    
    def handle_webhook_request(self, product_name, landing_page_url=None, farm_name=None, state=None, country=None, year=None, auto_commit=True):
        """Handle webhook request for QR code generation"""
        self.log(f"Starting QR code generation for product: {product_name}")
        
        try:
            # Step 1: Generate QR code value
            self.log("Step 1: Generating QR code value...")
            qr_code_value = self.generate_qr_code_value(product_name)
            
            # Use provided landing page URL or create a default one
            if not landing_page_url:
                landing_page_url = f"https://agroverse.com/product/{qr_code_value}"
            
            self.log(f"Generated QR code value: {qr_code_value}")
            self.log(f"Landing page: {landing_page_url}")
            self.log(f"Farm info: {farm_name}, {state}, {country}, {year}")
            
            # Step 2: Setup git
            self.log("Step 2: Setting up git...")
            self.setup_git()
            
            # Step 3: Create QR code image
            self.log("Step 3: Creating QR code image...")
            qr_image_path = os.path.join(self.workspace, f"{qr_code_value}.png")
            self.log(f"Creating QR code at path: {qr_image_path}")
            self.create_qr_image(qr_code_value, landing_page_url, qr_image_path, farm_name, state, country, year)
            
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
                upload_result = self.upload_to_github(qr_code_value, qr_image_path, commit_message)
            
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
                    'raw_url': upload_result['raw_url'],
                    'commit_url': upload_result['commit_url']
                })
            
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
    parser.add_argument("product_name", help="Name of the product to generate QR code for")
    parser.add_argument("--landing-page-url", help="Landing page URL for the QR code")
    parser.add_argument("--farm-name", help="Farm name for the QR code")
    parser.add_argument("--state", help="State for the QR code")
    parser.add_argument("--country", help="Country for the QR code")
    parser.add_argument("--year", help="Year for the QR code")
    parser.add_argument("--github-token", help="GitHub personal access token")
    parser.add_argument("--no-commit", action="store_true", help="Don't commit to GitHub")
    parser.add_argument("--output-file", help="Output file for results (JSON)")
    
    args = parser.parse_args()
    
    # Initialize handler
    handler = GitHubWebhookHandler(github_token=args.github_token)
    
    try:
        # Handle the webhook request
        result = handler.handle_webhook_request(
            args.product_name,
            landing_page_url=args.landing_page_url,
            farm_name=args.farm_name,
            state=args.state,
            country=args.country,
            year=args.year,
            auto_commit=not args.no_commit
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
            'product_name': args.product_name,
            'timestamp': datetime.now().isoformat()
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()
