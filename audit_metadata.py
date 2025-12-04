import json
import os
import requests
import logging
from typing import Set, Dict, List, Tuple
from tqdm import tqdm
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class MetadataAuditor:
    def __init__(self):
        self.target_url = os.getenv('DHIS2_URL').rstrip('/')
        self.target_auth = (os.getenv('DHIS2_USERNAME'), os.getenv('DHIS2_PASSWORD'))
        
        # Optional Source Config (for name lookup)
        self.source_url = os.getenv('SOURCE_DHIS2_URL')
        self.source_auth = (os.getenv('SOURCE_USERNAME'), os.getenv('SOURCE_PASSWORD'))
        
        self.missing_uids: Dict[str, Set[str]] = {
            'dataElement': set(),
            'categoryOptionCombo': set(),
            'orgUnit': set()
        }
        self.mappings: Dict[str, Dict[str, str]] = {
            'dataElement': {},
            'categoryOptionCombo': {},
            'orgUnit': {}
        }

    def scan_file(self, file_path: str):
        """Scans the JSON file for all UIDs."""
        logger.info(f"Scanning {file_path}...")
        
        # Use ijson for memory efficiency if available, else json
        try:
            import ijson
            with open(file_path, 'rb') as f:
                # Assuming standard dataValueSets format
                objects = ijson.items(f, 'dataValues.item')
                for item in tqdm(objects, desc="Scanning records"):
                    if 'dataElement' in item:
                        self.missing_uids['dataElement'].add(item['dataElement'])
                    if 'categoryOptionCombo' in item:
                        self.missing_uids['categoryOptionCombo'].add(item['categoryOptionCombo'])
                    if 'attributeOptionCombo' in item:
                        self.missing_uids['categoryOptionCombo'].add(item['attributeOptionCombo'])
                    if 'orgUnit' in item:
                        self.missing_uids['orgUnit'].add(item['orgUnit'])
        except ImportError:
            logger.warning("ijson not found, loading full file into memory (slower)")
            with open(file_path, 'r') as f:
                data = json.load(f)
                for item in tqdm(data.get('dataValues', []), desc="Scanning records"):
                    self.missing_uids['dataElement'].add(item.get('dataElement'))
                    self.missing_uids['categoryOptionCombo'].add(item.get('categoryOptionCombo'))
                    self.missing_uids['categoryOptionCombo'].add(item.get('attributeOptionCombo'))
                    self.missing_uids['orgUnit'].add(item.get('orgUnit'))
        
        # Remove None
        for k in self.missing_uids:
            self.missing_uids[k].discard(None)
            
        logger.info(f"Found unique UIDs: DE={len(self.missing_uids['dataElement'])}, COC={len(self.missing_uids['categoryOptionCombo'])}, OU={len(self.missing_uids['orgUnit'])}")

    def check_existence_in_target(self):
        """Checks which UIDs actually exist in Target (Dev)."""
        logger.info("Checking existence in Target instance...")
        
        for type_name, uids in self.missing_uids.items():
            if not uids:
                continue
                
            # DHIS2 filter API allows checking multiple IDs: id:in:[id1,id2,...]
            # But URL length limits apply, so we batch
            uid_list = list(uids)
            existing = set()
            
            batch_size = 100
            endpoint = 'organisationUnits' if type_name == 'orgUnit' else f"{type_name}s"
            
            for i in tqdm(range(0, len(uid_list), batch_size), desc=f"Checking {type_name}"):
                batch = uid_list[i:i+batch_size]
                filter_str = f"id:in:[{','.join(batch)}]"
                url = f"{self.target_url}/api/{endpoint}?filter={filter_str}&fields=id&paging=false"
                
                try:
                    resp = requests.get(url, auth=self.target_auth)
                    if resp.status_code == 200:
                        found = resp.json().get(endpoint, [])
                        for item in found:
                            existing.add(item['id'])
                except Exception as e:
                    logger.error(f"Error checking {type_name}: {e}")

            # Update missing_uids to ONLY contain truly missing ones
            self.missing_uids[type_name] = uids - existing
            logger.info(f"Missing {type_name} in Target: {len(self.missing_uids[type_name])}")

    def resolve_coc_by_structure(self, src_uid: str, src_name: str) -> str:
        """
        Resolves a Category Option Combo by matching its underlying Category Options.
        1. Get Source COC's Category Options (names).
        2. Find corresponding Target Category Options (by name).
        3. Find Target COC that has exactly these Target Options.
        """
        try:
            # 1. Get Source Options
            url = f"{self.source_url}/api/categoryOptionCombos/{src_uid}?fields=categoryOptions[name]"
            resp = requests.get(url, auth=self.source_auth)
            if resp.status_code != 200:
                return None
            
            src_options = [opt['name'] for opt in resp.json().get('categoryOptions', [])]
            if not src_options:
                return None # Default COC?

            # 2. Find Target Options
            target_opt_uids = []
            for opt_name in src_options:
                # Search for option by name in Target
                url = f"{self.target_url}/api/categoryOptions?filter=name:eq:{opt_name}&fields=id"
                resp = requests.get(url, auth=self.target_auth)
                if resp.status_code == 200:
                    found = resp.json().get('categoryOptions', [])
                    if found:
                        target_opt_uids.append(found[0]['id'])
                    else:
                        logger.warning(f"  - Option '{opt_name}' not found in Target")
                        return None # Cannot map if an option is missing
                else:
                    return None

            # 3. Find Target COC with these options
            # We can't easily query COCs by option list via standard filter.
            # Strategy: Fetch ALL COCs from Target (or a subset) and check their options? Too slow.
            # Better Strategy: Query for COCs that have the first option, then filter in memory?
            
            # Actually, DHIS2 API allows filtering COCs by categoryOptions.id
            # filter=categoryOptions.id:in:[id1,id2] matches COCs that have ANY of these.
            # We need ALL.
            
            # Let's try to find COCs that contain the first option, then filter.
            if not target_opt_uids:
                return None
                
            first_opt = target_opt_uids[0]
            url = f"{self.target_url}/api/categoryOptionCombos?filter=categoryOptions.id:eq:{first_opt}&fields=id,name,categoryOptions[id]"
            resp = requests.get(url, auth=self.target_auth)
            if resp.status_code == 200:
                candidates = resp.json().get('categoryOptionCombos', [])
                target_set = set(target_opt_uids)
                
                for cand in candidates:
                    cand_opts = {o['id'] for o in cand.get('categoryOptions', [])}
                    if cand_opts == target_set:
                        logger.info(f"  + Structural Match: {src_name} -> {cand['name']} ({cand['id']})")
                        return cand['id']
            
            return None

        except Exception as e:
            logger.error(f"Error in structural mapping: {e}")
            return None

    def resolve_by_name(self):
        """
        If Source config is present:
        1. Get names of missing UIDs from Source.
        2. Search for those names in Target.
        3. Create mapping if found.
        """
        if not self.source_url:
            logger.warning("No SOURCE_DHIS2_URL configured. Cannot resolve by name.")
            return

        logger.info("Resolving missing UIDs by name using Source instance...")
        
        for type_name, uids in self.missing_uids.items():
            if not uids:
                continue
                
            endpoint = 'organisationUnits' if type_name == 'orgUnit' else f"{type_name}s"
            
            # 1. Get Names from Source
            uid_to_name = {}
            uid_list = list(uids)
            batch_size = 100
            
            for i in tqdm(range(0, len(uid_list), batch_size), desc=f"Fetching names for {type_name}"):
                batch = uid_list[i:i+batch_size]
                filter_str = f"id:in:[{','.join(batch)}]"
                url = f"{self.source_url}/api/{endpoint}?filter={filter_str}&fields=id,name"
                
                try:
                    resp = requests.get(url, auth=self.source_auth)
                    if resp.status_code == 200:
                        found = resp.json().get(endpoint, [])
                        for item in found:
                            uid_to_name[item['id']] = item['name']
                except Exception as e:
                    logger.error(f"Error fetching names: {e}")

            # 2. Find these names in Target
            logger.info(f"Found {len(uid_to_name)} names to resolve.")
            
            for src_uid, name in tqdm(uid_to_name.items(), desc=f"Mapping {type_name}"):
                
                # SPECIAL HANDLING FOR CATEGORY OPTION COMBOS
                if type_name == 'categoryOptionCombo':
                    target_uid = self.resolve_coc_by_structure(src_uid, name)
                    if target_uid:
                        self.mappings[type_name][src_uid] = target_uid
                        continue # Success, move to next
                
                # Strategy 1: Case-insensitive exact match
                url = f"{self.target_url}/api/{endpoint}?filter=name:ilike:{name}&fields=id,name"
                found = []
                try:
                    resp = requests.get(url, auth=self.target_auth)
                    if resp.status_code == 200:
                        found = resp.json().get(endpoint, [])
                except Exception as e:
                    logger.error(f"Error searching target: {e}")

                # Strategy 2: Try stripping common suffixes if not found
                if not found and 'orgUnit' in endpoint:
                    suffixes = [' P.S', ' Primary School', ' PS', ' Nursery School']
                    clean_name = name
                    for suffix in suffixes:
                        if clean_name.endswith(suffix):
                            clean_name = clean_name[:-len(suffix)]
                            break
                    
                    if clean_name != name:
                        url = f"{self.target_url}/api/{endpoint}?filter=name:ilike:{clean_name}&fields=id,name"
                        try:
                            resp = requests.get(url, auth=self.target_auth)
                            if resp.status_code == 200:
                                found = resp.json().get(endpoint, [])
                        except:
                            pass

                if found:
                    # Pick the best match (exact name match preferred)
                    best_match = found[0]
                    for match in found:
                        if match['name'].lower() == name.lower():
                            best_match = match
                            break
                            
                    target_uid = best_match['id']
                    self.mappings[type_name][src_uid] = target_uid
                    logger.info(f"MAPPED: {name} -> {best_match['name']} ({target_uid})")
                else:
                    logger.warning(f"NOT FOUND in Target: {name} ({src_uid})")

    def save_mappings(self):
        """Updates mappings.json and generates report"""
        # Add unresolved missing UIDs with placeholders
        for type_name, uids in self.missing_uids.items():
            for uid in uids:
                if uid not in self.mappings[type_name]:
                    self.mappings[type_name][uid] = "REPLACE_WITH_DEV_UID"

        output = {
            "categoryOptionCombo": self.mappings['categoryOptionCombo'],
            "dataElement": self.mappings['dataElement'],
            "orgUnit": self.mappings['orgUnit']
        }
        
        # Load existing to merge
        if os.path.exists('mappings.json'):
            try:
                with open('mappings.json', 'r') as f:
                    existing = json.load(f)
                    # Merge (new wins, but preserve existing keys not in new)
                    for k, v in output.items():
                        if k in existing:
                            # We want to keep existing entries that are NOT in output
                            # But output should overwrite existing entries if they share keys
                            # Actually, self.mappings only contains what we found/audited.
                            # If we want to preserve manual rules like 'fix_email', we should merge CAREFULLY.
                            
                            # Strategy: Start with existing, update with new
                            merged_section = existing[k].copy()
                            merged_section.update(v)
                            output[k] = merged_section
                        else:
                            # Key doesn't exist in existing, just use output
                            pass
            except Exception as e:
                logger.warning(f"Failed to merge with existing mappings.json: {e}")
        
        # Save JSON
        with open('mappings.json', 'w') as f:
            json.dump(output, f, indent=4)
        logger.info("Mappings saved to mappings.json")

        # Generate Report for Manual Mapping
        if self.source_url:
            with open('missing_metadata_report.txt', 'w') as f:
                f.write("--- MISSING METADATA REPORT ---\n")
                f.write("Use this to manually fill in mappings.json\n\n")
                
                for type_name, uids in self.missing_uids.items():
                    unresolved = [uid for uid in uids if self.mappings[type_name].get(uid) == "REPLACE_WITH_DEV_UID"]
                    if not unresolved:
                        continue
                        
                    f.write(f"=== {type_name} ({len(unresolved)} missing) ===\n")
                    
                    # Fetch names for reporting if we haven't already
                    # (We might have fetched them in resolve_by_name but didn't store them globally)
                    # For efficiency, we'll just re-fetch or rely on logs, but let's do a quick fetch for the report
                    
                    # Simple batch fetch for report
                    uid_list = list(unresolved)
                    batch_size = 100
                    endpoint = 'organisationUnits' if type_name == 'orgUnit' else f"{type_name}s"
                    
                    for i in range(0, len(uid_list), batch_size):
                        batch = uid_list[i:i+batch_size]
                        filter_str = f"id:in:[{','.join(batch)}]"
                        url = f"{self.source_url}/api/{endpoint}?filter={filter_str}&fields=id,name"
                        try:
                            resp = requests.get(url, auth=self.source_auth)
                            if resp.status_code == 200:
                                for item in resp.json().get(endpoint, []):
                                    f.write(f"{item['id']} : {item['name']}\n")
                        except:
                            pass
                    f.write("\n")
            logger.info("Report saved to missing_metadata_report.txt")

if __name__ == "__main__":
    auditor = MetadataAuditor()
    
    # 1. Scan File
    input_file = os.getenv('DHIS2_INPUT_FILE', 'data.json')
    auditor.scan_file(input_file)
    
    # 2. Check what's missing
    auditor.check_existence_in_target()
    
    # 3. Try to resolve by name (if Source configured)
    auditor.resolve_by_name()
    
    # 4. Save results
    auditor.save_mappings()
    
    print("\n--- Audit Complete ---")
    print("Check mappings.json for results.")
    if not os.getenv('SOURCE_DHIS2_URL'):
        print("\n[TIP] To auto-map by name, add SOURCE_DHIS2_URL, SOURCE_USERNAME, SOURCE_PASSWORD to .env")
