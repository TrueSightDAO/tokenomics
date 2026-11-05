import base64

# Input and output file paths
input_file = 'edgar_aws_billing_automation_google_cloud_key.json'
output_file = 'edgar_aws_billing_automation_google_cloud_key_base64.txt'

# Read and encode the file
with open(input_file, 'rb') as f:
    json_content = f.read()
    base64_encoded = base64.b64encode(json_content).decode('utf-8')

# Save to output file
with open(output_file, 'w') as f:
    f.write(base64_encoded)

print(f"Base64-encoded content saved to {output_file}")