import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()

import getpass

import sys

# Configuration
de_id = sys.argv[1] if len(sys.argv) > 1 else 'Gf3F8QC2qCY'
url = f"{os.getenv('DHIS2_URL')}/api/dataElements/{de_id}"
user = os.getenv('DHIS2_USERNAME')
pwd = os.getenv('DHIS2_PASSWORD')

if not pwd:
    pwd = getpass.getpass(f"Enter password for {user}: ")

print(f"\nQuerying Data Element: {url}")

try:
    response = requests.get(url, auth=(user, pwd))
    if response.status_code == 200:
        data = response.json()
        print("\n--- Data Element Details ---")
        print(f"Name: {data.get('name')}")
        print(f"Short Name: {data.get('shortName')}")
        print(f"Value Type: {data.get('valueType')}")
        print(f"Domain Type: {data.get('domainType')}")
        print(f"Option Set: {data.get('optionSet', {}).get('id', 'None')}")
        print("-" * 30)
    else:
        print(f"Error: {response.status_code} - {response.text}")

except Exception as e:
    print(f"Connection Error: {e}")
