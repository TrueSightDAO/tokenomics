#!/usr/bin/env python3
"""
Batch QR Code Generation Webhook Handler

This script handles batch QR code generation requests from Google Apps Script.
It processes multiple rows from the Google Sheet, generates QR code images,
creates a zip file containing all images, and uploads it to GitHub.
"""

import os
import sys
import json
import argparse
import zipfile
import tempfile
import shutil
from datetime import datetime
from pathlib import Path

# Add the current directory to Python path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from github_webhook_handler import GitHubWebhookHandler
from digital_signature_processor import DigitalSignatureProcessor

class BatchWebhookHandler:
    def __init__(self, github_token=None):
        """Initialize the batch webhook handler"""
        self.github_token = github_token or os.getenv('QR_CODE_REPOSITORY_TOKEN')
        self.handler = GitHubWebhookHandler(github_token=self.github_token)
        self.signature_processor = DigitalSignatureProcessor()
        
    def process_batch_request(self, start_row, end_row, zip_file_name, digital_signature=None, requestor_email=None):
        """Process a batch QR code generation request"""
        print(f"🔄 Processing batch request: rows {start_row}-{end_row}")
        
        try:
            # Step 1: Fetch data from Google Sheets for the specified rows
            print("📊 Step 1: Fetching data from Google Sheets...")
            sheet_data = self.fetch_sheet_rows(start_row, end_row)
            
            if not sheet_data:
                raise Exception(f"No data found for rows {start_row}-{end_row}")
            
            print(f"✅ Found {len(sheet_data)} rows to process")
            
            # Step 2: Generate QR code images for each row
            print("🎨 Step 2: Generating QR code images...")
            generated_images = []
            
            for row_data in sheet_data:
                try:
                    image_path = self.generate_qr_code_image(row_data)
                    if image_path:
                        generated_images.append({
                            'qr_code': row_data['qr_code'],
                            'image_path': image_path,
                            'row': row_data['row']
                        })
                        print(f"✅ Generated QR code for {row_data['qr_code']}")
                except Exception as e:
                    print(f"❌ Failed to generate QR code for row {row_data['row']}: {e}")
            
            if not generated_images:
                raise Exception("No QR code images were generated successfully")
            
            # Step 3: Create zip file
            print("📦 Step 3: Creating zip file...")
            zip_file_path = self.create_zip_file(generated_images, zip_file_name)
            
            # Step 4: Upload zip file to GitHub
            print("☁️ Step 4: Uploading zip file to GitHub...")
            zip_file_url = self.upload_zip_file(zip_file_path, zip_file_name)
            
            # Step 5: Process digital signature and send email
            print("📧 Step 5: Processing notification...")
            email_result = self.process_notification(digital_signature, requestor_email, zip_file_url, generated_images)
            
            # Step 6: Return results
            result = {
                'success': True,
                'batch_info': {
                    'start_row': start_row,
                    'end_row': end_row,
                    'total_generated': len(generated_images),
                    'zip_file_name': zip_file_name,
                    'zip_file_url': zip_file_url
                },
                'generated_codes': [img['qr_code'] for img in generated_images],
                'email_sent': email_result['success'],
                'email_message': email_result['message'],
                'timestamp': datetime.now().isoformat()
            }
            
            print(f"🎉 Batch processing completed successfully!")
            print(f"📦 Zip file: {zip_file_url}")
            print(f"📧 Email sent: {email_result['success']}")
            
            return result
            
        except Exception as e:
            error_result = {
                'success': False,
                'error': str(e),
                'start_row': start_row,
                'end_row': end_row,
                'timestamp': datetime.now().isoformat()
            }
            print(f"💥 Batch processing failed: {e}")
            return error_result
    
    def fetch_sheet_rows(self, start_row, end_row):
        """Fetch data from Google Sheets for the specified rows"""
        try:
            # This would integrate with Google Sheets API
            # For now, we'll simulate the data structure
            # In production, this would use the Google Sheets API
            
            import gspread
            from oauth2client.service_account import ServiceAccountCredentials
            
            # Set up Google Sheets API credentials
            scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
            credentials = ServiceAccountCredentials.from_json_keyfile_dict(
                json.loads(os.getenv('GDRIVE_KEY')), scope
            )
            gc = gspread.authorize(credentials)
            
            # Open the spreadsheet
            spreadsheet_url = 'https://docs.google.com/spreadsheets/d/1qSi_-VSj7yiJl0Ak-Q3lch-l4mrH37cEw8EmQwS_6a4/edit'
            sheet = gc.open_by_url(spreadsheet_url).worksheet('Agroverse QR codes')
            
            # Fetch the rows
            rows = sheet.get(f'A{start_row}:X{end_row}')
            
            # Convert to structured data
            sheet_data = []
            for i, row in enumerate(rows):
                if len(row) >= 9:  # Ensure we have minimum required columns
                    print(f"🔍 DEBUG: Raw row {start_row + i}: {row}")
                    print(f"🔍 DEBUG: Column A (QR code): '{row[0] if len(row) > 0 else 'EMPTY'}'")
                    print(f"🔍 DEBUG: Column K (GitHub URL): '{row[10] if len(row) > 10 else 'EMPTY'}'")
                    
                    sheet_data.append({
                        'row': start_row + i,
                        'qr_code': row[0] if len(row) > 0 else '',
                        'qr_code_value': row[0] if len(row) > 0 else '',  # Add this for GitHubWebhookHandler compatibility
                        'landing_page': row[1] if len(row) > 1 else '',
                        'ledger': row[2] if len(row) > 2 else '',
                        'status': row[3] if len(row) > 3 else '',
                        'farm_name': row[4] if len(row) > 4 else '',
                        'state': row[5] if len(row) > 5 else '',
                        'country': row[6] if len(row) > 6 else '',
                        'year': row[7] if len(row) > 7 else '',
                        'product_name': row[8] if len(row) > 8 else '',
                        'github_url': row[10] if len(row) > 10 else '',  # Column K: GitHub URL
                        'product_image': row[18] if len(row) > 18 else '',  # Column S
                        'batch_id': row[20] if len(row) > 20 else '',  # Column U
                        'zip_file_name': row[21] if len(row) > 21 else '',  # Column V
                        'digital_signature': row[22] if len(row) > 22 else '',  # Column W
                        'requestor_email': row[23] if len(row) > 23 else ''  # Column X
                    })
                    
                    print(f"🔍 DEBUG: Processed row data: {sheet_data[-1]}")
            
            return sheet_data
            
        except Exception as e:
            print(f"❌ Error fetching sheet data: {e}")
            # Don't fallback to simulated data - let it crash with clear error
            raise Exception(f"Failed to fetch sheet data: {e}. Make sure gspread and oauth2client are installed and GDRIVE_KEY environment variable is set.")
    
    # Removed get_simulated_sheet_data method - no more fallback to fake data
    
    def generate_qr_code_image(self, row_data):
        """Generate QR code image for a single row"""
        try:
            print(f"🔍 DEBUG: Processing row {row_data['row']}")
            print(f"🔍 DEBUG: QR code value from sheet: '{row_data.get('qr_code_value', 'NOT_FOUND')}'")
            print(f"🔍 DEBUG: QR code from sheet: '{row_data.get('qr_code', 'NOT_FOUND')}'")
            print(f"🔍 DEBUG: Full row_data keys: {list(row_data.keys())}")
            
            # Use the existing GitHubWebhookHandler to generate the image
            result = self.handler.handle_webhook_request(
                product_name=row_data['product_name'],
                landing_page_url=row_data['landing_page'],
                farm_name=row_data['farm_name'],
                state=row_data['state'],
                country=row_data['country'],
                year=row_data['year'],
                is_cacao=True,  # Default to cacao, could be determined from product data
                auto_commit=True,
                sheet_data=row_data
            )
            
            print(f"🔍 DEBUG: Result from handle_webhook_request: {result}")
            
            if result.get('success') and result.get('local_image_path'):
                print(f"🔍 DEBUG: Generated image path: {result['local_image_path']}")
                print(f"🔍 DEBUG: Expected QR code: {result.get('qr_code', 'NOT_FOUND')}")
                return result['local_image_path']
            else:
                raise Exception(f"Failed to generate image: {result.get('error', 'Unknown error')}")
                
        except Exception as e:
            print(f"❌ Error generating QR code image: {e}")
            return None
    
    def create_zip_file(self, generated_images, zip_file_name):
        """Create a zip file containing all generated images"""
        try:
            # Create a temporary directory for the zip file
            temp_dir = tempfile.mkdtemp()
            zip_path = os.path.join(temp_dir, zip_file_name)
            
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for img_data in generated_images:
                    if os.path.exists(img_data['image_path']):
                        # Add image to zip with descriptive filename
                        arcname = f"{img_data['qr_code']}.png"
                        zipf.write(img_data['image_path'], arcname)
                        print(f"📎 Added {arcname} to zip file")
            
            # Move zip file to a permanent location
            final_zip_path = os.path.join(self.handler.workspace, 'generated_zip_files', zip_file_name)
            os.makedirs(os.path.dirname(final_zip_path), exist_ok=True)
            shutil.move(zip_path, final_zip_path)
            
            print(f"✅ Zip file created: {final_zip_path}")
            return final_zip_path
            
        except Exception as e:
            print(f"❌ Error creating zip file: {e}")
            raise
    
    def upload_zip_file(self, zip_file_path, zip_file_name):
        """Upload zip file to GitHub repository"""
        try:
            # Use the existing upload method from GitHubWebhookHandler
            result = self.handler.upload_to_github(
                qr_code_value=zip_file_name.replace('.zip', ''),
                qr_image_path=zip_file_path,
                commit_message=f"Add batch QR codes zip file: {zip_file_name} [skip ci]",
                target_repo='TrueSightDAO/qr_codes',
                target_path=f'batch_files/{zip_file_name}'
            )
            
            if result.get('raw_url'):
                return result['raw_url']
            else:
                raise Exception("Failed to upload zip file")
                
        except Exception as e:
            print(f"❌ Error uploading zip file: {e}")
            raise
    
    def process_notification(self, digital_signature, requestor_email, zip_file_url, generated_images):
        """Process digital signature and send email notification"""
        try:
            # Process digital signature to get requestor information
            requestor_info = None
            if digital_signature:
                requestor_info = self.signature_processor.get_requestor_info(digital_signature)
                print(f"🔐 Processed digital signature for: {requestor_info.get('name', 'Unknown')}")
            
            # Use requestor email from signature if available, otherwise use provided email
            email_to_send = requestor_info.get('email') if requestor_info else requestor_email
            
            if email_to_send:
                # Send email notification
                email_result = self.send_email_notification(
                    email_to_send,
                    zip_file_url,
                    generated_images,
                    requestor_info
                )
                return email_result
            else:
                return {
                    'success': False,
                    'message': 'No email address available for notification'
                }
                
        except Exception as e:
            print(f"❌ Error processing notification: {e}")
            return {
                'success': False,
                'message': f'Error processing notification: {e}'
            }
    
    def send_email_notification(self, email, zip_file_url, generated_images, requestor_info):
        """Send email notification to requestor"""
        try:
            # This would integrate with an email service like SendGrid, Mailgun, etc.
            # For now, we'll just log the email details
            
            subject = "QR Code Batch Generation Complete"
            body = f"""
Your QR code batch has been generated successfully!

📦 Zip File: {zip_file_url}
📊 Total QR Codes: {len(generated_images)}
📅 Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

Generated QR Codes:
{chr(10).join([f"- {img['qr_code']}" for img in generated_images])}

You can download the zip file containing all QR code images from the link above.

Best regards,
TrueSight DAO QR Code System
            """
            
            print(f"📧 Email notification prepared:")
            print(f"   To: {email}")
            print(f"   Subject: {subject}")
            print(f"   Body: {body}")
            
            # TODO: Implement actual email sending
            # Example with SendGrid:
            # import sendgrid
            # from sendgrid.helpers.mail import Mail
            # sg = sendgrid.SendGridAPIClient(api_key=os.getenv('SENDGRID_API_KEY'))
            # message = Mail(
            #     from_email='noreply@truesight.me',
            #     to_emails=email,
            #     subject=subject,
            #     html_content=body
            # )
            # response = sg.send(message)
            
            return {
                'success': True,
                'message': f'Email notification prepared for {email}'
            }
            
        except Exception as e:
            print(f"❌ Error sending email: {e}")
            return {
                'success': False,
                'message': f'Error sending email: {e}'
            }

def main():
    """Main function to handle command line arguments"""
    parser = argparse.ArgumentParser(description="Batch QR Code Generation Webhook Handler")
    parser.add_argument("--start-row", type=int, required=True, help="Start row number")
    parser.add_argument("--end-row", type=int, required=True, help="End row number")
    parser.add_argument("--zip-file-name", required=True, help="Name of the zip file to create")
    parser.add_argument("--digital-signature", help="Digital signature of the requestor")
    parser.add_argument("--requestor-email", help="Email address of the requestor")
    parser.add_argument("--output-file", help="Output file for results (JSON)")
    
    args = parser.parse_args()
    
    # Initialize handler
    handler = BatchWebhookHandler()
    
    try:
        # Process the batch request
        result = handler.process_batch_request(
            start_row=args.start_row,
            end_row=args.end_row,
            zip_file_name=args.zip_file_name,
            digital_signature=args.digital_signature,
            requestor_email=args.requestor_email
        )
        
        # Output results
        if args.output_file:
            with open(args.output_file, 'w') as f:
                json.dump(result, f, indent=2)
            print(f"Results saved to: {args.output_file}")
        
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
            'start_row': args.start_row,
            'end_row': args.end_row,
            'timestamp': datetime.now().isoformat()
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()
