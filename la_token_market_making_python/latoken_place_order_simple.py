import requests
import datetime
import hashlib
import hmac

import os
from dotenv import load_dotenv
load_dotenv()
import sys
# Add current working directory to path for module imports
sys.path.append(os.getcwd())


apiKey = os.getenv('LATOKEN_API_KEY')
apiSecret = os.getenv('LATOKEN_API_SECRET')
baseUrl = 'https://api.latoken.com'
endpoint = '/v2/auth/order/place'
DEFAULT_CURRENCY_ID = os.getenv("LATOKEN_CURRENCY_ID", "cbfd4c19-259c-420b-9bb2-498493265648")
DEFAULT_QUOTE_ID = os.getenv("LATOKEN_QUOTE_ID", "0c3a106d-bde3-4c13-a26e-3fd2394529e5")


params = {
    'baseCurrency': DEFAULT_CURRENCY_ID,
    'quoteCurrency': DEFAULT_QUOTE_ID,
    'side': 'BUY',
    'condition': 'GOOD_TILL_CANCELLED',
    'type': 'LIMIT',
    'price': '0.001',
    'quantity': '5'
}
serializeFunc = map(lambda it : it[0] + '=' + str(it[1]), params.items())
bodyParams = '&'.join(serializeFunc)
                  
signature = hmac.new(
    apiSecret, 
    ('POST' + endpoint + bodyParams).encode('ascii'), 
    hashlib.sha512
)

url = baseUrl + endpoint

response = requests.post(
    url,
    headers = {
        'Content-Type': 'application/json',
        'X-LA-APIKEY': apiKey,
        'X-LA-SIGNATURE': signature.hexdigest(),
        'X-LA-DIGEST': 'HMAC-SHA512'
    },
    json = params
)

print(response.json())