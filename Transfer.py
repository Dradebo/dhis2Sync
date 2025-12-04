import os
import json
import time
import logging
import ijson
import requests
import itertools
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Iterator, List, Dict, Any, Optional
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from tqdm import tqdm
import getpass
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not installed, ignore

# ======================================================================================
# LAYER 1: DOMAIN & CONFIGURATION
# ======================================================================================

@dataclass
class MigrationConfig:
    """Holds configuration for the migration process."""
    dhis2_url: str
    username: str
    password: str
    input_file: str
    batch_size: int
    endpoint_type: str  # 'tracker' or 'legacy' or 'aggregate'
    json_list_key: str  # e.g., 'events', 'trackedEntities', 'dataValues'
    dry_run: bool = False
    import_strategy: str = 'CREATE_AND_UPDATE'  # For aggregate: CREATE, UPDATE, CREATE_AND_UPDATE, DELETE
    inter_batch_delay: float = 0.5  # Seconds to wait between batches
    async_tracker: bool = True  # Use async mode for tracker imports
    skip_audit: bool = False  # Skip audit for performance (dev instances)

class ImportResult:
    """Standardized result object for a batch import."""
    def __init__(self, success: bool, status_code: int, message: str, conflicts: List[str] = None):
        self.success = success
        self.status_code = status_code
        self.message = message
        self.conflicts = conflicts or []

    def __repr__(self):
        return f"ImportResult(success={self.success}, code={self.status_code}, msg={self.message})"

# ======================================================================================
# LAYER 2: INTERFACES (PORTS)
# ======================================================================================

class IDataSource(ABC):
    """Interface for fetching data (Streaming)."""
    @abstractmethod
    def stream_data(self) -> Iterator[Dict[str, Any]]:
        pass

class IDataSink(ABC):
    """Interface for sending data (DHIS2 API)."""
    @abstractmethod
    def send_batch(self, batch: List[Dict[str, Any]]) -> ImportResult:
        pass

class IUserInterface(ABC):
    """Interface for user interaction and feedback."""
    @abstractmethod
    def update_progress(self, count: int):
        pass
    
    @abstractmethod
    def log_info(self, message: str):
        pass

    @abstractmethod
    def log_error(self, message: str):
        pass

    @abstractmethod
    def ask_recovery_strategy(self, error_msg: str) -> str:
        """Ask user how to handle a failure: 'retry', 'skip', 'abort'."""
        pass

# ======================================================================================
# LAYER 3: INFRASTRUCTURE (ADAPTERS)
# ======================================================================================

class JsonFileStreamer(IDataSource):
    """
    Implements efficient streaming using ijson.
    Reference PDF Section 3: 'High-Efficiency JSON Streaming'
    """
    def __init__(self, file_path: str, list_key: str):
        self.file_path = file_path
        self.list_key = list_key

    def stream_data(self) -> Iterator[Dict[str, Any]]:
        """
        Yields items one by one from the JSON file without loading the whole file.
        Uses prefix 'list_key.item' to navigate the JSON structure.
        """
        if not os.path.exists(self.file_path):
            raise FileNotFoundError(f"Input file not found: {self.file_path}")

        prefix = f"{self.list_key}.item"
        
        # Safe opening with ijson
        try:
            with open(self.file_path, 'rb') as f:
                # We use ijson.items to yield objects from the array at 'prefix'
                parser = ijson.items(f, prefix)
                for item in parser:
                    yield item
        except ijson.common.IncompleteJSONError as e:
            raise ValueError(f"Corrupt or incomplete JSON file: {e}")

class DHIS2Client(IDataSink):
    """
    Handles communication with DHIS2.
    Reference PDF Section 2: 'Architectural Analysis of DHIS2 API Endpoints'
    """
    def __init__(self, config: MigrationConfig):
        self.config = config
        self.session = self._create_retry_session()
        
        # Determine endpoint URL
        self.url = self._get_endpoint_url()

    def _create_retry_session(self):
        """Creates a requests session with automatic retry logic."""
        session = requests.Session()
        session.auth = (self.config.username, self.config.password)
        session.headers.update({'Content-Type': 'application/json'})
        
        # Retry on 502, 503, 504 (Gateway/Server errors) + 408 (Timeout)
        retries = Retry(total=8, backoff_factor=2, status_forcelist=[408, 502, 503, 504])
        session.mount('https://', HTTPAdapter(max_retries=retries))
        session.mount('http://', HTTPAdapter(max_retries=retries))
        return session

    def _get_endpoint_url(self):
        """Constructs the URL based on the selected strategy."""
        base = self.config.dhis2_url.rstrip('/')
        
        if self.config.endpoint_type == 'tracker':
            # Use async for tracker imports if configured
            async_param = 'true' if self.config.async_tracker else 'false'
            return f"{base}/api/tracker?async={async_param}"
        elif self.config.endpoint_type == 'legacy':
            return f"{base}/api/events"
        elif self.config.endpoint_type == 'aggregate':
            # Add import parameters for aggregate endpoint
            # skipPatternValidation=true allows invalid emails/phone numbers to be imported
            params = f"importStrategy={self.config.import_strategy}&dryRun=false&skipPatternValidation=true"
            # Temporarily disabled skipAudit - may cause issues on some instances
            # if self.config.skip_audit:
            #     params += "&skipAudit=true"
            return f"{base}/api/dataValueSets?{params}"
        else:
            raise ValueError("Unknown endpoint type")

    def _construct_payload(self, batch: List[Dict[str, Any]]) -> Dict:
        """Wraps the list of items into the correct root key for the API."""
        return {self.config.json_list_key: batch}
    
    def _poll_tracker_job(self, job_id: str, max_wait: int = 300) -> ImportResult:
        """Poll async tracker job until completion.
        
        Args:
            job_id: The tracker job ID from async response
            max_wait: Maximum seconds to wait (default 5 minutes)
            
        Returns:
            ImportResult based on final job status
        """
        base = self.config.dhis2_url.rstrip('/')
        job_url = f"{base}/api/tracker/jobs/{job_id}"
        
        elapsed = 0
        backoff = 1  # Start with 1 second
        
        while elapsed < max_wait:
            try:
                response = self.session.get(job_url, timeout=30)
                if response.status_code == 200:
                    job_data = response.json()
                    status = job_data.get('status', 'RUNNING')
                    
                    if status == 'COMPLETED':
                        return ImportResult(True, 200, "Tracker job completed successfully")
                    elif status == 'ERROR':
                        error_msg = job_data.get('message', 'Unknown error')
                        return ImportResult(False, 200, f"Tracker job failed: {error_msg}")
                    elif status in ['RUNNING', 'PENDING']:
                        # Keep polling
                        time.sleep(backoff)
                        elapsed += backoff
                        backoff = min(backoff * 1.5, 10)  # Max 10 second backoff
                    else:
                        return ImportResult(False, 200, f"Unknown tracker job status: {status}")
                else:
                    return ImportResult(False, response.status_code, f"Failed to poll job: {response.text}")
            except Exception as e:
                return ImportResult(False, 0, f"Error polling tracker job: {str(e)}")
        
        return ImportResult(False, 0, f"Tracker job timeout after {max_wait}s")

    def _load_mappings(self) -> Dict[str, Any]:
        """Load mappings from JSON file if it exists."""
        mapping_file = 'mappings.json'
        if os.path.exists(mapping_file):
            try:
                with open(mapping_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"[WARN] Failed to load mappings.json: {e}")
        return {}

    def _sanitize_batch(self, batch: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Sanitizes batch data using external mappings.
        """
        mappings = self._load_mappings()
        coc_map = mappings.get('categoryOptionCombo', {})
        de_rules = mappings.get('dataElement', {})
        ou_map = mappings.get('orgUnit', {})

        sanitized = []
        for item in batch:
            # 1. Map Category Option Combos
            coc = item.get('categoryOptionCombo')
            if coc in coc_map:
                item['categoryOptionCombo'] = coc_map[coc]
            
            aoc = item.get('attributeOptionCombo')
            if aoc in coc_map:
                item['attributeOptionCombo'] = coc_map[aoc]

            # 2. Map Organisation Units & Skip if Missing
            ou = item.get('orgUnit')
            if ou in ou_map:
                mapped_ou = ou_map[ou]
                if mapped_ou == "REPLACE_WITH_DEV_UID":
                    continue # Skip this record (OrgUnit not found in Dev)
                item['orgUnit'] = mapped_ou

            # 3. Apply Data Element Rules (e.g. Email/Phone Fix)
            de = item.get('dataElement')
            if de in de_rules:
                rule = de_rules[de]
                val = item.get('value', '')
                
                if rule.get('fix_email'):
                    if '@' not in val:
                        item['value'] = 'invalid_fixed@example.com'
                
                elif rule.get('fix_phone'):
                    # Simple check: if it contains letters or is the known dummy value
                    if any(c.isalpha() for c in val):
                        item['value'] = '0000000000'
            
            sanitized.append(item)
        return sanitized

    def send_batch(self, batch: List[Dict[str, Any]]) -> ImportResult:
        if self.config.dry_run:
            time.sleep(0.1) # Simulate network lag
            return ImportResult(True, 200, "Dry Run Success")

        # Sanitize batch before sending
        batch = self._sanitize_batch(batch)

        payload = self._construct_payload(batch)
        
        try:
            response = self.session.post(self.url, json=payload, timeout=180)
            
            # Handle 4xx Client Errors (Auth, Bad Data) immediately
            if 400 <= response.status_code < 500:
                return ImportResult(False, response.status_code, f"Client Error: {response.text}")

            # Handle 2xx Success (Logic requires parsing ImportSummary)
            if 200 <= response.status_code < 300:
                response_data = response.json()
                
                # Check if this is an async tracker response
                if self.config.endpoint_type == 'tracker' and self.config.async_tracker:
                    if 'response' in response_data and 'id' in response_data.get('response', {}):
                        job_id = response_data['response']['id']
                        # Poll for job completion
                        return self._poll_tracker_job(job_id)
                
                # Otherwise parse normally
                return self._parse_response(response_data)

            response.raise_for_status() # Will trigger retry logic for 5xx via Adapter

        except Exception as e:
            return ImportResult(False, 0, f"Connection/Network Error: {str(e)}")
            
        return ImportResult(False, 0, "Unknown State")

    def _parse_response(self, response_json: Dict) -> ImportResult:
        """
        Parses DHIS2 specific response formats.
        Enhanced to better distinguish hard failures from soft ignores.
        """
        # Check for standard ImportSummary (Legacy/Aggregate)
        if 'importCount' in response_json:
            counts = response_json['importCount']
            ignored = counts.get('ignored', 0)
            imported = counts.get('imported', 0)
            updated = counts.get('updated', 0)
            deleted = counts.get('deleted', 0)
            
            status = response_json.get('status')
            total_success = imported + updated + deleted
            total_processed = total_success + ignored
            
            # Extract conflicts for detailed error messages
            conflicts = []
            if 'conflicts' in response_json:
                conflicts = [str(c) for c in response_json.get('conflicts', [])][:5]  # Limit to first 5
            
            # Hard failure: status ERROR and nothing imported/updated
            if status == 'ERROR' and total_success == 0:
                msg = f"HARD FAILURE. All {total_processed} records rejected."
                return ImportResult(False, 200, msg, conflicts)
            
            # Soft ignore: some records ignored but others succeeded
            elif ignored > 0 and total_success > 0:
                msg = f"Partial Success. Imp:{imported} Upd:{updated} Ign:{ignored}"
                # This is still a success since some data was imported
                return ImportResult(True, 200, msg, conflicts)
            
            # All ignored (likely duplicates) - treat as success if no ERROR status
            elif ignored > 0 and total_success == 0 and status != 'ERROR':
                msg = f"All {ignored} records already exist (duplicates). No update needed."
                return ImportResult(True, 200, msg, conflicts)
            
            # Full success
            return ImportResult(True, 200, f"Success. Imp:{imported} Upd:{updated} Del:{deleted}")

        # Check for Tracker BundleReport
        elif 'status' in response_json and 'bundleReport' in response_json:
             # Simplified check for Tracker
             status = response_json['status']
             if status == 'OK':
                 return ImportResult(True, 200, "Tracker Bundle Imported Successfully")
             else:
                 return ImportResult(False, 200, f"Tracker Error: {status}")
        
        # Fallback
        return ImportResult(True, 200, "Request received (parsing unavailable)")

class TerminalUI(IUserInterface):
    """
    Interacts with the user via the terminal.
    """
    def __init__(self):
        self.pbar = None

    def init_pbar(self, desc="Migrating"):
        # Since we are streaming, we might not know the total. 
        # We use a dynamic counter.
        self.pbar = tqdm(unit=" recs", desc=desc)

    def update_progress(self, count: int):
        if self.pbar is not None:
            self.pbar.update(count)

    def close_pbar(self):
        if self.pbar is not None:
            self.pbar.close()

    def log_info(self, message: str):
        if self.pbar is not None:
            self.pbar.write(f"[\033[92mINFO\033[0m] {message}")
        else:
            print(f"[INFO] {message}")

    def log_error(self, message: str):
        if self.pbar is not None:
            self.pbar.write(f"[\033[91mERROR\033[0m] {message}")
        else:
            print(f"[ERROR] {message}")

    def ask_recovery_strategy(self, error_msg: str) -> str:
        """
        Interactive Error Handling Query.
        Pauses the progress bar to ask user for input.
        """
        # Clear bar for a moment to show clean prompt
        if self.pbar is not None: self.pbar.clear()
        
        print("\n" + "="*60)
        print(f" \033[91mCRITICAL BATCH FAILURE DETECTED\033[0m ")
        print("="*60)
        print(f"Reason: {error_msg}")
        print("-" * 60)
        print("How would you like to proceed?")
        print("  [r] Retry  - Try sending this batch again.")
        print("  [s] Skip   - Discard this batch and continue (Data loss!).")
        print("  [a] Abort  - Stop the migration immediately.")
        print("="*60)
        
        while True:
            choice = input("Selection [r/s/a]: ").lower().strip()
            if choice in ['r', 'retry']: return 'retry'
            if choice in ['s', 'skip']: return 'skip'
            if choice in ['a', 'abort']: return 'abort'

# ======================================================================================
# LAYER 4: APPLICATION LOGIC (USE CASES)
# ======================================================================================

class Batcher:
    """Helper to chunk the stream."""
    @staticmethod
    def chunk_generator(generator, batch_size):
        iterator = iter(generator)
        for first in iterator:
            yield list(itertools.chain([first], itertools.islice(iterator, batch_size - 1)))

    @staticmethod
    def chunk_by_org_unit(generator, max_batch_size):
        """
        Chunks data by Organisation Unit.
        Yields a batch when:
        1. The OrgUnit changes.
        2. OR the batch size reaches max_batch_size.
        """
        current_batch = []
        current_ou = None
        
        for item in generator:
            ou = item.get('orgUnit')
            
            # If OrgUnit changes and we have data, yield current batch
            if current_ou is not None and ou != current_ou:
                if current_batch:
                    yield current_batch
                current_batch = []
            
            current_ou = ou
            current_batch.append(item)
            
            # Cap size to prevent massive batches
            if len(current_batch) >= max_batch_size:
                yield current_batch
                current_batch = []
        
        # Yield remaining
        if current_batch:
            yield current_batch

class MigrationService:
    """
    Orchestrates the migration process using the components.
    """
    def __init__(self, source: IDataSource, sink: IDataSink, ui: IUserInterface, batch_size: int):
        self.source = source
        self.sink = sink
        self.ui = ui
        self.batch_size = batch_size

    def run(self):
        self.ui.init_pbar()
        # Use Smart OrgUnit Batching
        batch_stream = Batcher.chunk_by_org_unit(self.source.stream_data(), self.batch_size)
        
        total_records = 0
        total_batches = 0
        failed_batches = 0

        try:
            for batch in batch_stream:
                total_batches += 1
                batch_len = len(batch)
                
                # Processing Loop with Interactive Recovery
                while True:
                    if batch:
                        ou_id = batch[0].get('orgUnit', 'Unknown')
                        self.ui.log_info(f"Processing batch for OrgUnit: {ou_id}")

                    result = self.sink.send_batch(batch)
                    
                    if result.success:
                        self.ui.update_progress(batch_len)
                        total_records += batch_len
                        self.ui.log_info(result.message)
                        break # Success, move to next batch
                    
                    # Failure Handling
                    if "Connection/Network Error" in result.message:
                        # Auto-Retry for Network Issues
                        self.ui.log_error(f"Network error detected: {result.message}")
                        self.ui.log_error("Retrying in 10 seconds...")
                        time.sleep(10)
                        continue # Retry the same batch
                    else:
                        # Auto-Skip for Data Conflicts/Validation Errors
                        self.ui.log_error(f"Batch failed (Conflict/Error): {result.message}")
                        if result.conflicts:
                            for c in result.conflicts:
                                self.ui.log_error(f"  - {c}")
                        self.ui.log_error("Auto-skipping batch to continue migration...")
                        failed_batches += 1
                        break # Skip and move to next batch

                # Rate limiting
                if hasattr(self.sink, 'config') and self.sink.config.inter_batch_delay > 0:
                    time.sleep(self.sink.config.inter_batch_delay)

        except KeyboardInterrupt:
            self.ui.log_error("\nMigration aborted by user.")
        except Exception as e:
             self.ui.log_error(f"\nUnexpected Error: {e}")
        finally:
            self.ui.close_pbar()
            self.print_summary(total_batches, total_records, failed_batches)

    def print_summary(self, batches, records, failures):
        print("\n" + "="*40)
        print("       MIGRATION SUMMARY       ")
        print("="*40)
        print(f"Total Batches Processed : {batches}")
        print(f"Total Records Uploaded  : {records}")
        print(f"Failed/Skipped Batches  : {failures}")
        print("="*40)


# ======================================================================================
# MAIN ENTRY POINT
# ======================================================================================

def main():
    # 1. Setup Logging
    logging.basicConfig(level=logging.INFO, filename='migration_audit.log', filemode='w',
                        format='%(asctime)s - %(levelname)s - %(message)s')

    # 2. Interactive Setup (Clean Prompt)
    print("\n--- DHIS2 Python Migrator ---\n")
    
    # Defaults for quick testing (Can be replaced with Env Vars)
    def_url = os.environ.get('DHIS2_URL', 'https://play.dhis2.org/2.38.1')
    def_user = os.environ.get('DHIS2_USERNAME', os.environ.get('DHIS2_USER', 'admin'))
    
    url = input(f"DHIS2 URL [{def_url}]: ").strip() or def_url
    user = input(f"Username [{def_user}]: ").strip() or def_user
    pwd = os.environ.get('DHIS2_PASSWORD', os.environ.get('DHIS2_PASS'))
    if not pwd:
        pwd = getpass.getpass("Password: ")
    
    def_file = os.environ.get('DHIS2_INPUT_FILE', 'data.json')
    file_path = input(f"Path to JSON dump [{def_file}]: ").strip() or def_file
    
    print("\nSelect Endpoint Type:")
    print("1. Aggregate (DataValues)")
    print("2. Legacy Events (Events)")
    print("3. Tracker (TrackedEntities)")
    
    choice = input("Choice [1]: ").strip()
    if choice == '2':
        endpoint = 'legacy'
        default_key = 'events'
    elif choice == '3':
        endpoint = 'tracker'
        default_key = 'trackedEntities'
    else:
        endpoint = 'aggregate'
        default_key = 'dataValues'

    list_key = input(f"JSON Key for list [{default_key}]: ").strip() or default_key
    
    # Ask about dev instance optimization
    is_dev = input("Is this a dev/test instance? (y/n) [n]: ").strip().lower() == 'y'
    
    # Optimize batch size based on endpoint type
    if endpoint == 'aggregate':
        optimal_batch_size = 50  # Increased from 25, safe with validation skipped
    elif endpoint == 'tracker':
        optimal_batch_size = 50   # Tracker needs smaller batches due to complexity
    else:
        optimal_batch_size = 100  # Legacy events default
    
    # 3. Initialize Configuration
    config = MigrationConfig(
        dhis2_url=url,
        username=user,
        password=pwd,
        input_file=file_path,
        batch_size=optimal_batch_size,
        endpoint_type=endpoint,
        json_list_key=list_key,
        skip_audit=is_dev,  # Skip audit for dev instances
        import_strategy='CREATE_AND_UPDATE',  # Update existing data
        inter_batch_delay=0.5,  # Half second delay between batches
        async_tracker=True  # Use async for tracker imports
    )

    # 4. Verify File
    # Expand ~ and make path absolute
    config.input_file = os.path.expanduser(config.input_file)
    config.input_file = os.path.abspath(config.input_file)
    
    if not os.path.exists(config.input_file):
        print(f"\n[FATAL] File {config.input_file} does not exist.")
        # Create a dummy file for demonstration if it doesn't exist
        if input("Create dummy file for testing? (y/n): ").lower() == 'y':
            with open(config.input_file, 'w') as f:
                json.dump({list_key: [{"dataElement": "uid", "value": i} for i in range(500)]}, f)
            print("Dummy file created.")
        else:
            return

    # 5. Dependency Injection
    streamer = JsonFileStreamer(config.input_file, config.json_list_key)
    client = DHIS2Client(config)
    ui = TerminalUI()
    
    # 6. Run App
    app = MigrationService(streamer, client, ui, config.batch_size)
    app.run()

if __name__ == "__main__":
    main()