#!/usr/bin/env python3
"""
Digital Signature Processor

This module handles digital signature verification and requestor identification
for the QR code generation system. It integrates with the existing DApp
signature verification system.
"""

import os
import json
import base64
import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.exceptions import InvalidSignature

class DigitalSignatureProcessor:
    def __init__(self):
        """Initialize the digital signature processor"""
        self.asset_management_api = 'https://script.google.com/macros/s/AKfycbygmwRbyqse-dpCYMco0rb93NSgg-Jc1QIw7kUiBM7CZK6jnWnMB5DEjdoX_eCsvVs7/exec'
    
    def get_requestor_info(self, digital_signature):
        """
        Extract requestor information from a digital signature
        
        Args:
            digital_signature (str): Base64 encoded digital signature
            
        Returns:
            dict: Requestor information including name, email, etc.
        """
        try:
            print(f"🔐 Processing digital signature: {digital_signature[:50]}...")
            
            # Step 1: Verify the signature and get contributor info
            contributor_info = self.fetch_contributor_info(digital_signature)
            
            if not contributor_info:
                print("❌ Could not fetch contributor information")
                return None
            
            # Step 2: Extract requestor details
            requestor_info = {
                'name': contributor_info.get('name', 'Unknown'),
                'email': contributor_info.get('email', ''),
                'digital_signature': digital_signature,
                'voting_rights': contributor_info.get('voting_rights', 0),
                'verified': True
            }
            
            print(f"✅ Requestor identified: {requestor_info['name']}")
            return requestor_info
            
        except Exception as e:
            print(f"❌ Error processing digital signature: {e}")
            return None
    
    def fetch_contributor_info(self, digital_signature):
        """
        Fetch contributor information from the Asset Management API
        
        Args:
            digital_signature (str): Base64 encoded digital signature
            
        Returns:
            dict: Contributor information from the API
        """
        try:
            # Make API call to get contributor info
            params = {
                'digital_signature': digital_signature,
                'action': 'get_contributor_info'
            }
            
            response = requests.get(self.asset_management_api, params=params, timeout=30)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success':
                    return data.get('data', {})
                else:
                    print(f"❌ API error: {data.get('message', 'Unknown error')}")
                    return None
            else:
                print(f"❌ HTTP error: {response.status_code}")
                return None
                
        except Exception as e:
            print(f"❌ Error fetching contributor info: {e}")
            return None
    
    def verify_signature(self, message, signature, public_key):
        """
        Verify a digital signature using RSA
        
        Args:
            message (str): Original message
            signature (str): Base64 encoded signature
            public_key (str): Base64 encoded public key
            
        Returns:
            bool: True if signature is valid, False otherwise
        """
        try:
            # Decode the public key
            public_key_bytes = base64.b64decode(public_key)
            public_key_obj = serialization.load_der_public_key(public_key_bytes)
            
            # Decode the signature
            signature_bytes = base64.b64decode(signature)
            
            # Verify the signature
            public_key_obj.verify(
                signature_bytes,
                message.encode('utf-8'),
                padding.PKCS1v15(),
                hashes.SHA256()
            )
            
            return True
            
        except (InvalidSignature, Exception) as e:
            print(f"❌ Signature verification failed: {e}")
            return False
    
    def extract_signature_from_request(self, request_text):
        """
        Extract digital signature from a request text
        
        Args:
            request_text (str): Full request text including signature
            
        Returns:
            dict: Extracted signature components
        """
        try:
            lines = request_text.split('\n')
            signature_info = {}
            
            for i, line in enumerate(lines):
                if line.startswith('My Digital Signature:'):
                    signature_info['public_key'] = line.replace('My Digital Signature:', '').strip()
                elif line.startswith('Request Transaction ID:'):
                    signature_info['signature'] = line.replace('Request Transaction ID:', '').strip()
                elif line.startswith('--------'):
                    # Extract the message part (everything before the signature)
                    signature_info['message'] = '\n'.join(lines[:i]).strip()
                    break
            
            return signature_info
            
        except Exception as e:
            print(f"❌ Error extracting signature: {e}")
            return None
    
    def get_requestor_from_dapp_request(self, request_text):
        """
        Process a complete DApp request and extract requestor information
        
        Args:
            request_text (str): Complete request text from DApp
            
        Returns:
            dict: Requestor information
        """
        try:
            # Extract signature components
            signature_components = self.extract_signature_from_request(request_text)
            
            if not signature_components:
                return None
            
            # Verify the signature
            if not self.verify_signature(
                signature_components['message'],
                signature_components['signature'],
                signature_components['public_key']
            ):
                print("❌ Signature verification failed")
                return None
            
            # Get requestor info using the public key as digital signature
            return self.get_requestor_info(signature_components['public_key'])
            
        except Exception as e:
            print(f"❌ Error processing DApp request: {e}")
            return None

def main():
    """Test function for the digital signature processor"""
    processor = DigitalSignatureProcessor()
    
    # Test with a sample digital signature
    test_signature = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA54jNZdN4xkaPDI9TB/RwuicbbUMvttOWSTVRfvZxiHWeIoqTHRz2WJdoGsuW9rz9QPbpz6T9zQZu3RNzsSF216U3aCd89R2g7qhOMh9VC+7+sNJnI6H4qPPKFbndxQD8262Q+zqYQR6r0k89mud1sYbla/DCtKAcGZsALihVyl8tF2v1rUzfPU9FHpi5ow2kOEpVxnhe6xEY1HDU/zuFRt707WzkG1zit4AWEBXyBd3YLyinPNAb2aBA6dSPnPAQ4aB46Dtis3p5DgkLeO7E4gh/E0BqViDkkB1tLy1dgy9Kjv+5zxo1yTxkBKACjqqo69Q0VrUfkXgegWmXBAu04wIDAQAB"
    
    print("🧪 Testing Digital Signature Processor...")
    
    # Test 1: Get requestor info from digital signature
    requestor_info = processor.get_requestor_info(test_signature)
    if requestor_info:
        print(f"✅ Requestor info: {json.dumps(requestor_info, indent=2)}")
    else:
        print("❌ Could not get requestor info")
    
    # Test 2: Process a complete DApp request
    test_request = """[QR CODE BATCH REQUEST]
Product: Test Product
Quantity: 10
--------
My Digital Signature: MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA54jNZdN4xkaPDI9TB/RwuicbbUMvttOWSTVRfvZxiHWeIoqTHRz2WJdoGsuW9rz9QPbpz6T9zQZu3RNzsSF216U3aCd89R2g7qhOMh9VC+7+sNJnI6H4qPPKFbndxQD8262Q+zqYQR6r0k89mud1sYbla/DCtKAcGZsALihVyl8tF2v1rUzfPU9FHpi5ow2kOEpVxnhe6xEY1HDU/zuFRt707WzkG1zit4AWEBXyBd3YLyinPNAb2aBA6dSPnPAQ4aB46Dtis3p5DgkLeO7E4gh/E0BqViDkkB1tLy1dgy9Kjv+5zxo1yTxkBKACjqqo69Q0VrUfkXgegWmXBAu04wIDAQAB
Request Transaction ID: Ne4/MH+5cQu/j0DKE3vUUp4Jq5BVk6wqHmLhhLN5qvEPL6ogtRLJItaV7LAZrdfahOedpBLkmAjw3Do2KNblA0Mftaf2gWZhxIudKbnFQvctHSSaZ0zT48NrNImWB+z8YLo0v/scDepf7gLsqgKrFTd5dcCHFmIxKLZ88d1aI6YhqFT4EKYOFDB4H3wfkCkPWJZ+KcAsk8oT1S+RNOl3fEBam4qFJ1DMGW1/mpY5WYO7D5NOFXDFjn1k0jOf5GSRooDNGlZholcHgHTilRz8VdaEo59fggSCQA/F8uRo1fKK5Hjski0F4869vfQM2L1P4jWd2Kl8EowINAlJK0A=="""
    
    dapp_requestor = processor.get_requestor_from_dapp_request(test_request)
    if dapp_requestor:
        print(f"✅ DApp requestor info: {json.dumps(dapp_requestor, indent=2)}")
    else:
        print("❌ Could not process DApp request")

if __name__ == "__main__":
    main()
