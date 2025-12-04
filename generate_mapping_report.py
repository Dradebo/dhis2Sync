import json
import os
import requests
import logging
from tqdm import tqdm
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Setup
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

SOURCE_URL = os.getenv('SOURCE_DHIS2_URL').rstrip('/')
SOURCE_AUTH = (os.getenv('SOURCE_USERNAME'), os.getenv('SOURCE_PASSWORD'))

TARGET_URL = os.getenv('DHIS2_URL').rstrip('/')
TARGET_AUTH = (os.getenv('DHIS2_USERNAME'), os.getenv('DHIS2_PASSWORD'))

def get_name(url, auth, uid, endpoint):
    try:
        resp = requests.get(f"{url}/api/{endpoint}/{uid}?fields=name", auth=auth)
        if resp.status_code == 200:
            return resp.json().get('name', 'Unknown')
    except:
        pass
    return "Error Fetching"

def generate_report():
    if not os.path.exists('mappings.json'):
        print("mappings.json not found.")
        return

    with open('mappings.json', 'r') as f:
        mappings = json.load(f)

    cocs = mappings.get('categoryOptionCombo', {})
    
    print(f"Generating report for {len(cocs)} Category Option Combos...")
    
    report_lines = []
    report_lines.append(f"{'SOURCE UID':<15} | {'SOURCE NAME':<50} | {'TARGET UID':<15} | {'TARGET NAME'}")
    report_lines.append("-" * 130)

    for src_uid, target_uid in tqdm(cocs.items()):
        if target_uid == "REPLACE_WITH_DEV_UID":
            continue
            
        src_name = get_name(SOURCE_URL, SOURCE_AUTH, src_uid, 'categoryOptionCombos')
        target_name = get_name(TARGET_URL, TARGET_AUTH, target_uid, 'categoryOptionCombos')
        
        report_lines.append(f"{src_uid:<15} | {src_name:<50} | {target_uid:<15} | {target_name}")

    # Write to file
    with open('coc_mapping_verification.txt', 'w') as f:
        f.write('\n'.join(report_lines))
    
    print("\nReport generated: coc_mapping_verification.txt")

if __name__ == "__main__":
    generate_report()
