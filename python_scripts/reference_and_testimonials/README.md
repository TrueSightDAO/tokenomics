# Reference and Testimonials Generator

This module helps generate professional references and testimonials for TrueSight DAO members applying for new positions.

## Overview

DAO members often request references or testimonials when applying for new roles. This tool fetches their complete contribution history from the [TrueSight DAO Contribution Ledger](https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0) and generates comprehensive summaries to support testimonial writing.

## Setup

### Prerequisites

1. **Python Dependencies** (already in parent `requirements.txt`):
   ```bash
   pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
   ```

2. **Google Sheets API Credentials**:
   - Uses `gdrive_schema_credentials.json` from `../schema_validation/`
   - Service account must have read access to the Contribution Ledger

### Directory Structure

```
reference_and_testimonials/
├── README.md                    # This file
├── fetch_contributions.py       # Fetches contribution data
├── testimonials/                # Output directory for testimonials
│   ├── fatima_toledo_contributions.json
│   ├── fatima_toledo_testimonial.md
│   └── ...
```

## Usage

### 1. Fetch Contribution Data

```bash
cd /Users/garyjob/Applications/tokenomics/python_scripts/reference_and_testimonials
python fetch_contributions.py "Fatima Toledo"
```

This will:
- ✅ Fetch all contributions from the Ledger history sheet (header row 4)
- ✅ Filter contributions for the specified member
- ✅ Analyze and categorize contributions
- ✅ Generate a detailed summary report
- ✅ Save raw data to `testimonials/<name>_contributions.json`

### 2. Review the Output

The script generates:
- **Console Summary**: Overview of contributions, projects, TDG awards, timeline
- **JSON File**: Complete contribution data for further analysis

### 3. Generate Testimonial

Use the contribution data to craft a personalized testimonial that:
- Highlights relevant skills and experiences
- Aligns with the target role requirements
- Provides specific examples from DAO contributions
- Demonstrates leadership, collaboration, and impact

## Data Source

**Spreadsheet**: [TrueSight DAO Main Ledger & Contributors](https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0)  
**Sheet**: `Ledger history`  
**Header Row**: 4  
**Columns**:
- Contributor Name
- Project Name
- Contribution Made
- Rubric classification
- TDGs Provisioned
- Status
- TDGs Issued
- Status date
- Solana Transfer Hash
- TDGs yet Air Dropped
- Discord ID
- Within past 90/180 days metrics

## Example: Fatima Toledo

**Target Role**: Executive Strategy Professional  
**Positioning**: Bridge communication gap between senior executives and younger teams familiar with lean startup methodology  
**Value Proposition**: Help companies become more competitive by improving cross-generational collaboration

**LinkedIn**: [Fatima Toledo](https://www.linkedin.com/in/fatima-toledo/)

### Process

1. **Fetch Data**:
   ```bash
   python fetch_contributions.py "Fatima Toledo"
   ```

2. **Review Contributions**:
   - Analyze project involvement
   - Identify strategic contributions
   - Note leadership and collaboration examples
   - Highlight cross-functional work

3. **Craft Testimonial**:
   - Focus on strategic thinking
   - Emphasize communication skills
   - Demonstrate ability to bridge gaps
   - Provide concrete examples
   - Quantify impact where possible

## Tips for Writing Testimonials

### Structure

1. **Opening**: Your relationship and context
2. **Key Strengths**: 2-3 main qualities with examples
3. **Specific Achievements**: Concrete contributions and impact
4. **Unique Value**: What sets them apart
5. **Recommendation**: Strong endorsement for target role

### Best Practices

- ✅ Be specific with examples
- ✅ Quantify impact (TDG awards, project scope, timeline)
- ✅ Align with target role requirements
- ✅ Highlight soft skills (communication, leadership, collaboration)
- ✅ Keep professional yet authentic tone
- ✅ Include your credentials and relationship

### Avoid

- ❌ Generic statements without examples
- ❌ Exaggeration or unverifiable claims
- ❌ Irrelevant details
- ❌ Overly casual language
- ❌ Focusing only on technical skills

## Contributing

When adding new testimonials:
1. Run `fetch_contributions.py` to get latest data
2. Save testimonial as `testimonials/<name>_testimonial.md`
3. Include both JSON data and final testimonial
4. Update this README with any new patterns or insights

## Related Documentation

- [SCHEMA.md](../../SCHEMA.md) - Complete data structure documentation
- [Contributors Contact Information](https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1460794618)
- [Main README](../../README.md) - Repository overview

---

**Maintained by**: TrueSight DAO Development Team  
**Repository**: https://github.com/TrueSightDAO/tokenomics
