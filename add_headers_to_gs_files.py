#!/usr/bin/env python3
"""
Add standardized headers to all .gs files in the repository.
"""

import os
import re
from pathlib import Path

# Script descriptions based on their purpose
DESCRIPTIONS = {
    'tdg_expenses_processing.gs': 'Processes expense submissions from Telegram, validates them against contributor signatures, and inserts transactions into appropriate ledgers (offchain or managed AGL ledgers based on inventory type encoding).',
    
    'process_sales_telegram_logs.gs': 'Parses and validates sales transactions from Telegram, extracts QR code and price information, and prepares them for ledger updates.',
    
    'sales_update_managed_agl_ledgers.gs': 'Updates managed AGL ledgers with sales transactions, inserting both transaction and balance records.',
    
    'sales_update_main_dao_offchain_ledger.gs': 'Updates the main DAO offchain ledger with sales revenue transactions.',
    
    'process_movement_telegram_logs.gs': 'Processes inventory movement requests from Telegram, validates them, and updates both source and destination ledgers.',
    
    'process_qr_code_generation_telegram_logs.gs': 'Processes QR code generation requests from Telegram and creates batch QR codes with proper tracking.',
    
    'web_app.gs': 'REST API endpoints for inventory management, QR code queries, voting rights, and asset valuation. Provides data access for the TrueSight DAO DApp.',
    
    'grok_scoring_for_telegram_and_whatsapp_logs.gs': 'AI-powered scoring of chat contributions from Telegram and WhatsApp using OpenAI/xAI APIs.',
    
    'transfer_scored_contributions_to_main_ledger.gs': 'Transfers approved scored contributions from the Grok spreadsheet to the main ledger history.',
    
    'proposal_manager.gs': 'Complete DAO proposal management system including creation, voting, and execution of proposals.',
    
    'register_member_digital_signatures_telegram.gs': 'Registers new contributor digital signatures submitted via Telegram.',
    
    'register_member_digital_signatures_email.gs': 'Registers new contributor digital signatures submitted via email.',
    
    'tdg_wix_dashboard.gs': 'Updates Wix dashboard metrics including treasury balance, TDG issuance, and exchange rates.',
    
    'agroverse_wix_site_updates.gs': 'Updates Agroverse Wix site statistics and metrics.',
    
    'populate_wix_event.gs': 'Triggers Wix automation workflows by creating events in the Wix Events API.',
    
    'importer_telegram_chatlogs_to_google_sheet.gs': 'Imports raw Telegram chat messages into Google Sheets for processing by other scripts.',
    
    'tdg_recurring_tokenization_monthly.gs': 'Processes monthly recurring token distributions for ongoing contributor payments.',
}

def create_header(file_path_rel: str, description: str = None) -> str:
    """Create standardized header for a .gs file"""
    if description is None:
        description = 'Google Apps Script for TrueSight DAO automation.'
    
    header = f"""/**
 * File: {file_path_rel}
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: {description}
 */

"""
    return header

def has_file_header(content: str) -> bool:
    """Check if file already has our standardized header"""
    return 'File: google_app_scripts/' in content and 'Repository: https://github.com/TrueSightDAO/tokenomics' in content

def add_header_to_file(file_path: Path, repo_root: Path):
    """Add header to a single .gs file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Check if header already exists
        if has_file_header(content):
            print(f"  ⏭️  Skipping {file_path.name} (already has header)")
            return False
        
        # Get relative path from repo root
        rel_path = file_path.relative_to(repo_root)
        rel_path_str = str(rel_path).replace('\\', '/')
        
        # Get description
        filename = file_path.name
        description = DESCRIPTIONS.get(filename, 'Google Apps Script for TrueSight DAO automation.')
        
        # Create header
        header = create_header(rel_path_str, description)
        
        # Prepend header to content
        new_content = header + content
        
        # Write back
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        
        print(f"  ✅ Added header to {file_path.name}")
        return True
        
    except Exception as e:
        print(f"  ❌ Error processing {file_path.name}: {e}")
        return False

def main():
    repo_root = Path(__file__).parent
    gs_scripts_dir = repo_root / 'google_app_scripts'
    
    if not gs_scripts_dir.exists():
        print(f"❌ Directory not found: {gs_scripts_dir}")
        return
    
    print("🔧 Adding standardized headers to .gs files...")
    print(f"Repository root: {repo_root}")
    print(f"Scripts directory: {gs_scripts_dir}\n")
    
    # Find all .gs files
    gs_files = list(gs_scripts_dir.rglob('*.gs'))
    
    print(f"Found {len(gs_files)} .gs files\n")
    
    updated_count = 0
    skipped_count = 0
    
    for gs_file in sorted(gs_files):
        rel_path = gs_file.relative_to(gs_scripts_dir)
        print(f"📄 {rel_path}")
        
        if add_header_to_file(gs_file, repo_root):
            updated_count += 1
        else:
            skipped_count += 1
    
    print(f"\n{'='*60}")
    print(f"✅ Updated: {updated_count} files")
    print(f"⏭️  Skipped: {skipped_count} files")
    print(f"📊 Total: {len(gs_files)} files")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()

