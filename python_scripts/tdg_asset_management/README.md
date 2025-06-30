# AWS recurring expense tokenizer

## Prerequisites

- Python 3.x
- Install dependencies (from the local requirements file):
  ```bash
  pip install -r requirements.txt
  ```

Save your Google API credential file to 
- edgar_aws_billing_automation_google_cloud_key.json

Run the following command
```
python3 generate_base64_credentials_for_environment.py
```

Set the output from edgar_aws_billing_automation_google_cloud_key_base64.txt to environment variable GOOGLE_CREDENTIALS


## Deployment for GitHub Action
Set the following variables as reposiory secrets

  - AWS_ACCESS_KEY_ID_GARYJOB
  - AWS_ACCESS_KEY_ID_GARYJOB
  - AWS_ACCESS_KEY_ID_NELAN
  - AWS_SECRET_ACCESS_KEY_NELAN
  - GOOGLE_CREDENTIALS

make sure not to mistake repository variables for environmental variables as the later does not get picked up by Github