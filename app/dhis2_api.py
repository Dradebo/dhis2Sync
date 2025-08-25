import json
import requests
from typing import Optional, Dict, Any

class Api:
    """DHIS2 API client - based on your existing CLI code"""
    
    def __init__(self, url: str, username: str, password: str):
        self.base_url = url.rstrip('/')
        self.auth = (username, password)
        self.name_cache: Dict[str, str] = {}  # Cache for org unit names

    def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> requests.Response:
        """GET request to DHIS2 API"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        print(f"Making GET request to: {url}")
        print(f"With params: {params}")
        print(f"Using auth: {self.auth[0]} / {'*' * len(self.auth[1])}")
        
        try:
            response = requests.get(url, params=params, auth=self.auth, timeout=10)
            # Show the actual URL that was requested (with query parameters)
            print(f"Actual URL requested: {response.url}")
            print(f"GET {url} - Status: {response.status_code}")
            if response.status_code != 200:
                print(f"Error response: {response.text[:200]}...")
            else:
                print("Success! Response received.")
            return response
        except requests.exceptions.RequestException as e:
            print(f"Request failed: {e}")
            # Return a mock response object for error handling
            class MockResponse:
                status_code = 500
                text = str(e)
                def json(self):
                    return {"error": str(e)}
            return MockResponse()

    def post(self, endpoint: str, json_payload: Dict[str, Any]) -> requests.Response:
        """POST request to DHIS2 API"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = {"Content-Type": "application/json"}
        print(f"POST {url}")
        print(f"Payload: {json.dumps(json_payload)[:200]}...")
        response = requests.post(url, json=json_payload, auth=self.auth, headers=headers)
        print(f"Response status: {response.status_code}")
        print(f"Response body: {response.text[:200]}...")
        return response

    def get_org_unit_name(self, org_unit_id: str) -> str:
        """Get cached organization unit name with fallback to ID"""
        if org_unit_id not in self.name_cache:
            try:
                response = self.get(f'api/organisationUnits/{org_unit_id}/gist')
                if response.status_code == 200:
                    data = response.json()
                    self.name_cache[org_unit_id] = data.get('name', org_unit_id)
                else:
                    self.name_cache[org_unit_id] = org_unit_id
            except Exception:
                self.name_cache[org_unit_id] = org_unit_id
        return self.name_cache[org_unit_id]

def build_completion_payload(json_data: Dict[str, Any], parent_ou: str, api: Api, period: str, dataset_id: str, include_parent: bool = False):
    """
    Build completion payload while checking for existing dataset registrations.
    Based on your existing CLI logic.
    
    Returns tuple of (completion_payload, incomplete_payload)
    """
    data_set = json_data.get("dataSet")
    if not data_set:
        raise ValueError("Missing `dataSet` in JSON response")

    # Extract org units that have actual data values
    orgs_with_data = set()
    for dv in json_data.get("dataValues", []):
        if (org_unit := dv.get("orgUnit")) and (dv_period := dv.get("period")):
            if dv_period == period:
                orgs_with_data.add(org_unit)

    # Fetch existing completion registrations
    try:
        response = api.get('api/completeDataSetRegistrations', params={
            'dataSet': dataset_id,
            'period': period,
            'orgUnit': parent_ou,
            'children': 'true'
        })

        if response.status_code != 200:
            print(f"Warning: Could not fetch completion status, status code: {response.status_code}")
            existing_completions = set()
        else:
            data = response.json()
            existing_completions = {
                reg.get('organisationUnit')
                for reg in data.get('completeDataSetRegistrations', [])
            }
    except Exception as e:
        print(f"Warning: Error fetching completion status: {str(e)}")
        existing_completions = set()

    # Create two payloads
    to_complete = {}
    to_incomplete = {}

    # Process orgs with data values (mark complete)
    for org_unit in orgs_with_data:
        if include_parent or org_unit != parent_ou:
            to_complete[(org_unit, period)] = {
                "dataSet": data_set,
                "period": period,
                "organisationUnit": org_unit,
                "completed": True
            }

    # Process orgs without data but marked as complete (mark incomplete)
    for org_unit in existing_completions:
        if org_unit not in orgs_with_data and (include_parent or org_unit != parent_ou):
            to_incomplete[(org_unit, period)] = {
                "dataSet": data_set,
                "period": period,  
                "organisationUnit": org_unit,
                "completed": False
            }

    # Create final payloads
    completion_payload = {"completeDataSetRegistrations": list(to_complete.values())} if to_complete else None
    incomplete_payload = {"completeDataSetRegistrations": list(to_incomplete.values())} if to_incomplete else None

    return completion_payload, incomplete_payload

def complete_datasets(parent_org_units: list, period: str, dataset_id: str, api: Api, include_parents: bool = False, threshold: int = 0):
    """
    Complete datasets based on your existing CLI logic.
    Returns results dictionary with completion statistics.
    """
    results = {
        'total_completed': 0,
        'total_unmarked': 0,
        'total_errors': 0,
        'hierarchy': {}
    }

    for parent_ou in parent_org_units:
        parent_name = api.get_org_unit_name(parent_ou)
        
        try:
            # Fetch data values for parent and children
            response = api.get('api/dataValueSets', params={
                'dataSet': dataset_id,
                'orgUnit': parent_ou,
                'period': period,
                'children': 'true'
            })

            if response.status_code != 200:
                raise ValueError(f"HTTP {response.status_code}: {response.text[:100]}...")

            data = response.json()

            # Apply threshold if specified
            if threshold > 0:
                data_values = data.get("dataValues", [])
                org_unit_counts = {}

                for dv in data_values:
                    ou = dv.get("orgUnit")
                    if ou:
                        org_unit_counts[ou] = org_unit_counts.get(ou, 0) + 1

                # Filter out org units that don't meet threshold
                filtered_values = [
                    dv for dv in data_values
                    if org_unit_counts.get(dv.get("orgUnit"), 0) >= threshold
                ]

                data["dataValues"] = filtered_values

            # Build completion and incomplete payloads
            completion_payload, incomplete_payload = build_completion_payload(
                data, parent_ou, api, period, dataset_id, include_parents
            )

            # Process completions
            if completion_payload:
                children = [reg['organisationUnit'] for reg in completion_payload['completeDataSetRegistrations']]
                
                child_info = []
                for child_ou in children:
                    child_name = api.get_org_unit_name(child_ou)
                    child_info.append({'id': child_ou, 'name': child_name})

                results['hierarchy'][parent_ou] = {
                    'name': parent_name,
                    'children': child_info
                }

                # Send completion request
                response = api.post("api/completeDataSetRegistrations", completion_payload)
                if response.status_code != 200:
                    raise ValueError(f"Completion failed: [{response.status_code}] {response.text[:100]}...")

                results['total_completed'] += len(children)

            # Process incomplete datasets  
            if incomplete_payload:
                unmarked = [reg['organisationUnit'] for reg in incomplete_payload['completeDataSetRegistrations']]
                
                unmarked_info = []
                for child_ou in unmarked:
                    child_name = api.get_org_unit_name(child_ou)
                    unmarked_info.append({'id': child_ou, 'name': child_name})

                if parent_ou in results['hierarchy']:
                    results['hierarchy'][parent_ou]['unmarked'] = unmarked_info
                else:
                    results['hierarchy'][parent_ou] = {
                        'name': parent_name,
                        'children': [],
                        'unmarked': unmarked_info
                    }

                # Send incomplete request
                response = api.post("api/completeDataSetRegistrations", incomplete_payload)
                if response.status_code != 200:
                    print(f"Warning: Failed to mark datasets as incomplete: [{response.status_code}] {response.text[:100]}...")
                else:
                    print(f"Successfully marked {len(unmarked)} datasets as incomplete")

                results['total_unmarked'] += len(unmarked)

        except Exception as e:
            results['total_errors'] += 1
            print(f"Error processing {parent_name} ({parent_ou}): {str(e)}")

    return results

def assess_data_element_compliance(parent_org_units: list, period: str, dataset_id: str, 
                                  required_elements: list, compliance_threshold: float, 
                                  api: Api, include_parents: bool = False):
    """
    Assess compliance based on data element completeness.
    
    Args:
        parent_org_units: List of parent org unit IDs
        period: Period to assess  
        dataset_id: Dataset ID
        required_elements: List of required data element IDs
        compliance_threshold: Percentage threshold for compliance (0-100)
        api: DHIS2 API instance
        include_parents: Whether to include parent org units in assessment
        
    Returns:
        Dictionary with compliance results including compliant/non-compliant org units
    """
    results = {
        'total_compliant': 0,
        'total_non_compliant': 0,
        'total_errors': 0,
        'hierarchy': {},
        'compliance_details': {}
    }

    for parent_ou in parent_org_units:
        parent_name = api.get_org_unit_name(parent_ou)
        
        try:
            # Fetch data values for parent and children
            response = api.get('api/dataValueSets', params={
                'dataSet': dataset_id,
                'orgUnit': parent_ou,
                'period': period,
                'children': 'true'
            })

            if response.status_code != 200:
                raise ValueError(f"HTTP {response.status_code}: {response.text[:100]}...")

            data = response.json()
            data_values = data.get("dataValues", [])
            
            print(f"DEBUG: Found {len(data_values)} data values for {parent_name} ({parent_ou})")
            
            # Group data values by org unit and data element
            org_unit_data = {}
            for dv in data_values:
                org_unit = dv.get("orgUnit")
                data_element = dv.get("dataElement")
                
                if org_unit and data_element and dv.get("value"):  # Only count non-empty values
                    if org_unit not in org_unit_data:
                        org_unit_data[org_unit] = set()
                    org_unit_data[org_unit].add(data_element)
            
            print(f"DEBUG: Org units with data: {list(org_unit_data.keys())}")
            for ou_id, elements in org_unit_data.items():
                ou_name = api.get_org_unit_name(ou_id)
                print(f"DEBUG: {ou_name} ({ou_id}) has data for {len(elements)} elements: {list(elements)}")
            
            # Assess compliance for each org unit that has data entries
            compliant_units = []
            non_compliant_units = []
            
            for org_unit_id, elements_with_data in org_unit_data.items():
                # Skip parent if not included
                if org_unit_id == parent_ou and not include_parents:
                    continue
                
                # Get org unit name
                org_unit_name = api.get_org_unit_name(org_unit_id)
                
                # Calculate compliance percentage
                required_elements_set = set(required_elements)
                elements_present = elements_with_data.intersection(required_elements_set)
                compliance_percentage = (len(elements_present) / len(required_elements_set)) * 100
                
                print(f"DEBUG: Checking {org_unit_name} - Required: {list(required_elements_set)}, Present: {list(elements_present)}")
                
                org_unit_info = {
                    'id': org_unit_id,
                    'name': org_unit_name,
                    'compliance_percentage': round(compliance_percentage, 1),
                    'elements_present': len(elements_present),
                    'elements_required': len(required_elements_set),
                    'missing_elements': list(required_elements_set - elements_present),
                    'has_data': True,  # All org units in dataValueSets have data
                    'total_entries': len(elements_with_data)  # Total data elements with values
                }
                
                # Store detailed compliance info
                results['compliance_details'][org_unit_id] = org_unit_info
                
                # Categorize as compliant or non-compliant
                if compliance_percentage >= compliance_threshold:
                    compliant_units.append(org_unit_info)
                    results['total_compliant'] += 1
                    print(f"DEBUG: {org_unit_name} is COMPLIANT ({compliance_percentage}%) - has {len(elements_present)}/{len(required_elements_set)} required elements")
                else:
                    non_compliant_units.append(org_unit_info)
                    results['total_non_compliant'] += 1
                    print(f"DEBUG: {org_unit_name} is NON-COMPLIANT ({compliance_percentage}%) - has {len(elements_present)}/{len(required_elements_set)} required elements")
            
            # Store hierarchy results
            results['hierarchy'][parent_ou] = {
                'name': parent_name,
                'compliant': compliant_units,
                'non_compliant': non_compliant_units,
                # Backward compatibility with old structure
                'children': compliant_units,  # Map compliant to children for UI compatibility
                'unmarked': non_compliant_units  # Map non-compliant to unmarked for UI compatibility
            }

        except Exception as e:
            results['total_errors'] += 1
            print(f"Error processing {parent_name} ({parent_ou}): {str(e)}")
            
            # Add error entry to hierarchy
            results['hierarchy'][parent_ou] = {
                'name': parent_name,
                'compliant': [],
                'non_compliant': [],
                'children': [],
                'unmarked': [],
                'error': str(e)
            }

    return results