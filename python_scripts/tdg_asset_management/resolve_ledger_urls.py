#!/usr/bin/env python3
"""
Script to parse legacy-redirects.js and match with Shipment Ledger Listing
to create resolved URL mappings.

This script:
1. Parses legacy-redirects.js to extract URL mappings
2. Matches shipment IDs from the sheet with redirect paths
3. Generates a mapping of resolved URLs
"""

import re
import json
from pathlib import Path

# Path to legacy-redirects.js file
# Try multiple possible locations
POSSIBLE_PATHS = [
    Path(__file__).parent.parent.parent / 'agroverse_shop' / 'js' / 'legacy-redirects.js',
    Path('/Users/garyjob/Applications/agroverse_shop/js/legacy-redirects.js'),
]

LEGACY_REDIRECTS_FILE = None
for path in POSSIBLE_PATHS:
    if path.exists():
        LEGACY_REDIRECTS_FILE = path
        break

def parse_legacy_redirects():
    """Parse legacy-redirects.js file and extract the LEGACY_REDIRECTS mapping."""
    redirects = {}
    
    if not LEGACY_REDIRECTS_FILE.exists():
        print(f"Error: {LEGACY_REDIRECTS_FILE} not found")
        return redirects
    
    with open(LEGACY_REDIRECTS_FILE, 'r') as f:
        content = f.read()
    
    # Extract the LEGACY_REDIRECTS object using regex
    # Pattern: '/agl1': 'https://...' (with quotes)
    # Match both single and double quotes
    pattern = r"['\"]/(agl\d+)['\"]:\s*['\"]([^'\"]+)['\"]"
    matches = re.findall(pattern, content)
    
    for path, url in matches:
        # Store with leading slash to match the format
        redirects[f'/{path}'] = url
    
    return redirects

def shipment_id_to_path(shipment_id):
    """Convert shipment ID (e.g., 'AGL6') to redirect path (e.g., '/agl6')."""
    if not shipment_id:
        return None
    
    # Convert to lowercase and add leading slash
    shipment_id = str(shipment_id).strip().upper()
    if shipment_id.startswith('AGL'):
        return '/' + shipment_id.lower()
    
    return None

def resolve_url_for_shipment(shipment_id, redirects_map):
    """Resolve the Google Sheets URL for a given shipment ID."""
    path = shipment_id_to_path(shipment_id)
    if not path:
        return None
    
    return redirects_map.get(path)

def main():
    print("=" * 80)
    print("Resolving Ledger URLs from legacy-redirects.js")
    print("=" * 80)
    print()
    
    # Parse legacy-redirects.js
    print("📖 Parsing legacy-redirects.js...")
    redirects = parse_legacy_redirects()
    
    print(f"✅ Found {len(redirects)} AGL redirect mappings:")
    for path, url in sorted(redirects.items()):
        print(f"   {path} -> {url[:60]}...")
    print()
    
    # Sample shipment IDs from the sheet (based on what we saw in the search results)
    # In reality, you would read these from the Google Sheet
    sample_shipments = [
        'AGL0', 'AGL1', 'AGL2', 'AGL3', 'AGL4', 'AGL5', 'AGL6', 
        'AGL7', 'AGL8', 'AGL9', 'AGL10', 'AGL13', 'AGL14'
    ]
    
    print("=" * 80)
    print("Resolved URL Mapping for Shipment Ledger Listing")
    print("=" * 80)
    print()
    print(f"{'Shipment ID':<15} {'Redirect Path':<20} {'Resolved URL':<70}")
    print("-" * 80)
    
    resolved_mappings = {}
    unresolved = []
    
    for shipment_id in sample_shipments:
        path = shipment_id_to_path(shipment_id)
        resolved_url = resolve_url_for_shipment(shipment_id, redirects)
        
        if resolved_url:
            resolved_mappings[shipment_id] = resolved_url
            print(f"{shipment_id:<15} {path:<20} {resolved_url}")
        else:
            unresolved.append(shipment_id)
            print(f"{shipment_id:<15} {path or 'N/A':<20} {'NOT FOUND'}")
    
    print()
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"✅ Resolved: {len(resolved_mappings)} shipments")
    print(f"❌ Unresolved: {len(unresolved)} shipments")
    if unresolved:
        print(f"   Unresolved IDs: {', '.join(unresolved)}")
    print()
    
    # Generate CSV format for easy import
    print("=" * 80)
    print("CSV Format (for new column in Shipment Ledger Listing)")
    print("=" * 80)
    print()
    print("Shipment ID,Resolved Ledger URL")
    for shipment_id, url in sorted(resolved_mappings.items()):
        print(f"{shipment_id},{url}")
    print()
    
    # Generate JSON format
    print("=" * 80)
    print("JSON Format (for programmatic use)")
    print("=" * 80)
    print()
    print(json.dumps(resolved_mappings, indent=2))
    print()
    
    # Show what the new column would look like
    print("=" * 80)
    print("New Column: 'Resolved Ledger URL' (Column N)")
    print("=" * 80)
    print()
    print("This column would contain the fully resolved Google Sheets URLs")
    print("that can be used directly without needing to resolve redirects.")
    print()
    print("Example values:")
    for shipment_id, url in list(resolved_mappings.items())[:5]:
        print(f"  {shipment_id}: {url}")
    print()

if __name__ == "__main__":
    main()

