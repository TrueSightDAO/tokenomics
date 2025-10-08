"""
Fetch DAO member contributions from TrueSight DAO Contribution Ledger

This script retrieves contribution history for DAO members to help generate
references and testimonials for job applications.

Repository: https://github.com/TrueSightDAO/tokenomics
"""

import os
import sys
from google.oauth2 import service_account
from googleapiclient.discovery import build
import json
from datetime import datetime

# Google Sheets API setup
SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'
SHEET_NAME = 'Ledger history'
HEADER_ROW = 4

def setup_google_sheets():
    """Initialize Google Sheets API service"""
    try:
        # Look for credentials in parent schema_validation folder
        creds_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), 
            'schema_validation', 
            'gdrive_schema_credentials.json'
        )
        
        if not os.path.exists(creds_path):
            print(f"❌ Credentials file not found: {creds_path}")
            return None
        
        creds = service_account.Credentials.from_service_account_file(
            creds_path, scopes=SCOPES)
        
        service = build('sheets', 'v4', credentials=creds)
        print("✅ Google Sheets API initialized")
        return service
        
    except Exception as e:
        print(f"❌ Failed to initialize Google Sheets API: {str(e)}")
        return None

def fetch_all_contributions(service):
    """Fetch all contributions from the Ledger history sheet"""
    try:
        # Fetch all data starting from header row
        range_name = f"{SHEET_NAME}!A{HEADER_ROW}:P"
        
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        
        if not values:
            print("❌ No data found in sheet")
            return None
        
        # First row is headers
        headers = values[0]
        data_rows = values[1:]
        
        print(f"\n📊 Found {len(data_rows)} contribution records")
        print(f"📋 Headers: {headers}\n")
        
        # Convert to list of dictionaries
        contributions = []
        for row in data_rows:
            # Pad row if it's shorter than headers
            while len(row) < len(headers):
                row.append('')
            
            contribution = {}
            for i, header in enumerate(headers):
                contribution[header] = row[i] if i < len(row) else ''
            
            contributions.append(contribution)
        
        return {
            'headers': headers,
            'contributions': contributions,
            'total_count': len(contributions)
        }
        
    except Exception as e:
        print(f"❌ Error fetching contributions: {str(e)}")
        return None

def get_contributor_contributions(all_data, contributor_name):
    """Filter contributions for a specific contributor"""
    if not all_data:
        return None
    
    contributions = all_data['contributions']
    
    # Filter by contributor name (case-insensitive partial match)
    filtered = [
        c for c in contributions 
        if contributor_name.lower() in c.get('Contributor Name', '').lower()
    ]
    
    print(f"\n🔍 Found {len(filtered)} contributions for '{contributor_name}'")
    
    return filtered

def analyze_contributions(contributions):
    """Analyze and categorize contributions"""
    if not contributions:
        return None
    
    analysis = {
        'total_contributions': len(contributions),
        'total_tdg_provisioned': 0,
        'total_tdg_issued': 0,
        'projects': set(),
        'rubric_categories': {},
        'date_range': {'earliest': None, 'latest': None},
        'contribution_types': [],
        'status_breakdown': {}
    }
    
    for contrib in contributions:
        # TDG amounts
        tdg_prov = 0
        try:
            tdg_prov = float(contrib.get('TDGs Provisioned', 0) or 0)
            analysis['total_tdg_provisioned'] += tdg_prov
        except:
            pass
        
        tdg_issued = 0
        try:
            tdg_issued = float(contrib.get('TDGs Issued', 0) or 0)
            analysis['total_tdg_issued'] += tdg_issued
        except:
            pass
        
        # Projects
        project = contrib.get('Project Name', '').strip()
        if project:
            analysis['projects'].add(project)
        
        # Rubric classification
        rubric = contrib.get('Rubric classification', '').strip()
        if rubric:
            analysis['rubric_categories'][rubric] = analysis['rubric_categories'].get(rubric, 0) + 1
        
        # Status
        status = contrib.get('Status', '').strip()
        if status:
            analysis['status_breakdown'][status] = analysis['status_breakdown'].get(status, 0) + 1
        
        # Date range
        status_date = contrib.get('Status date', '').strip()
        if status_date and len(status_date) == 8:  # YYYYMMDD format
            if not analysis['date_range']['earliest'] or status_date < analysis['date_range']['earliest']:
                analysis['date_range']['earliest'] = status_date
            if not analysis['date_range']['latest'] or status_date > analysis['date_range']['latest']:
                analysis['date_range']['latest'] = status_date
        
        # Contribution types
        contribution_made = contrib.get('Contribution Made', '').strip()
        if contribution_made:
            analysis['contribution_types'].append({
                'description': contribution_made,
                'project': project,
                'tdg': tdg_prov,
                'date': status_date,
                'status': status
            })
    
    analysis['projects'] = sorted(list(analysis['projects']))
    
    return analysis

def format_date(date_str):
    """Convert YYYYMMDD to readable format"""
    if not date_str or len(date_str) != 8:
        return date_str
    try:
        dt = datetime.strptime(date_str, '%Y%m%d')
        return dt.strftime('%B %Y')
    except:
        return date_str

def print_contribution_summary(contributor_name, contributions, analysis):
    """Print a formatted summary of contributions"""
    print("\n" + "="*80)
    print(f"📝 CONTRIBUTION SUMMARY FOR: {contributor_name.upper()}")
    print("="*80)
    
    if not contributions or not analysis:
        print("❌ No contributions found")
        return
    
    print(f"\n📊 OVERVIEW:")
    print(f"   • Total Contributions: {analysis['total_contributions']}")
    print(f"   • Total TDG Provisioned: {analysis['total_tdg_provisioned']:,.2f}")
    print(f"   • Total TDG Issued: {analysis['total_tdg_issued']:,.2f}")
    
    if analysis['date_range']['earliest'] and analysis['date_range']['latest']:
        print(f"   • Active Period: {format_date(analysis['date_range']['earliest'])} - {format_date(analysis['date_range']['latest'])}")
    
    print(f"\n🎯 PROJECTS INVOLVED ({len(analysis['projects'])}):")
    for project in analysis['projects']:
        print(f"   • {project}")
    
    print(f"\n📋 CONTRIBUTION CATEGORIES:")
    for rubric, count in sorted(analysis['rubric_categories'].items(), key=lambda x: x[1], reverse=True):
        print(f"   • {rubric}: {count} contribution(s)")
    
    print(f"\n✅ STATUS BREAKDOWN:")
    for status, count in sorted(analysis['status_breakdown'].items(), key=lambda x: x[1], reverse=True):
        print(f"   • {status}: {count}")
    
    print(f"\n📝 DETAILED CONTRIBUTIONS:")
    for i, contrib in enumerate(analysis['contribution_types'], 1):
        print(f"\n   {i}. {contrib['description']}")
        print(f"      Project: {contrib['project']}")
        print(f"      TDG Awarded: {contrib['tdg']:,.2f}")
        print(f"      Date: {format_date(contrib['date'])}")
        print(f"      Status: {contrib['status']}")
    
    print("\n" + "="*80 + "\n")

def save_contribution_data(contributor_name, contributions, analysis, output_dir='testimonials'):
    """Save contribution data to JSON file"""
    if not contributions:
        return None
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Sanitize filename
    safe_name = contributor_name.lower().replace(' ', '_').replace('.', '')
    filename = f"{safe_name}_contributions.json"
    filepath = os.path.join(output_dir, filename)
    
    data = {
        'contributor_name': contributor_name,
        'generated_date': datetime.now().isoformat(),
        'summary': {
            'total_contributions': analysis['total_contributions'],
            'total_tdg_provisioned': analysis['total_tdg_provisioned'],
            'total_tdg_issued': analysis['total_tdg_issued'],
            'projects': analysis['projects'],
            'date_range': analysis['date_range']
        },
        'analysis': analysis,
        'raw_contributions': contributions
    }
    
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2)
    
    print(f"💾 Saved contribution data to: {filepath}")
    return filepath

def main():
    """Main execution function"""
    if len(sys.argv) < 2:
        print("Usage: python fetch_contributions.py <contributor_name>")
        print("Example: python fetch_contributions.py 'Fatima Toledo'")
        sys.exit(1)
    
    contributor_name = sys.argv[1]
    
    print(f"\n🚀 Fetching contributions for: {contributor_name}")
    print(f"📊 Source: TrueSight DAO Contribution Ledger")
    print(f"🔗 https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit#gid=0\n")
    
    # Setup API
    service = setup_google_sheets()
    if not service:
        sys.exit(1)
    
    # Fetch all contributions
    all_data = fetch_all_contributions(service)
    if not all_data:
        sys.exit(1)
    
    # Filter for specific contributor
    contributions = get_contributor_contributions(all_data, contributor_name)
    
    if not contributions:
        print(f"\n❌ No contributions found for '{contributor_name}'")
        print("\n💡 Available contributors (sample):")
        unique_names = set(c.get('Contributor Name', '') for c in all_data['contributions'][:50])
        for name in sorted(unique_names)[:20]:
            if name:
                print(f"   • {name}")
        sys.exit(1)
    
    # Analyze contributions
    analysis = analyze_contributions(contributions)
    
    # Print summary
    print_contribution_summary(contributor_name, contributions, analysis)
    
    # Save to file
    save_contribution_data(contributor_name, contributions, analysis)
    
    print("✅ Done! Use this data to generate testimonials.")

if __name__ == "__main__":
    main()
