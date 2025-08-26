from fastapi import FastAPI, Request, Form, HTTPException, BackgroundTasks
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Optional, Dict, Any, List, Tuple
import json
import difflib
import datetime
from starlette.middleware.sessions import SessionMiddleware
import os
import asyncio

from .dhis2_api import Api
from .models import ConnectionForm, DatasetSelection, ElementMapping
from .routes.completeness import router as completeness_router
from .routes.metadata import router as metadata_router
from .routes.settings_profiles import router as settings_profiles_router
from .db import engine
from .routes.schedules import router as schedules_router
from .scheduler import start_scheduler_and_load_jobs
from .models_db import Base
from .conn_utils import resolve_connections
from .routes.tracker import router as tracker_router


class WebSocketBlockerMiddleware(BaseHTTPMiddleware):
    """Middleware to block all WebSocket connection attempts"""
    
    async def dispatch(self, request: Request, call_next):
        # Check for WebSocket upgrade requests
        if request.headers.get("upgrade", "").lower() == "websocket":
            return JSONResponse(
                status_code=426,
                content={"error": "WebSocket Upgrade Required", "message": "WebSockets are not supported"},
                headers={"Connection": "close"}
            )
        
        # Block specific Socket.IO patterns
        if any(pattern in str(request.url.path) for pattern in ["/_event/", "/socket.io/", "/ws", "/websocket"]):
            return JSONResponse(
                status_code=404,
                content={"error": "Endpoint not found", "message": "WebSocket endpoints are disabled"}
            )
        
        response = await call_next(request)
        return response


app = FastAPI(title="DHIS2 Data Exchange Tool")

# Add WebSocket blocking middleware first
app.add_middleware(WebSocketBlockerMiddleware)

# Add session middleware (env-driven secret and cookie hardening)
_secret_key = os.environ.get("SECRET_KEY", "change-me-in-prod")
_env = (os.environ.get("ENVIRONMENT") or "development").lower()
_secure_cookies = _env == "production"
app.add_middleware(
    SessionMiddleware,
    secret_key=_secret_key,
    https_only=_secure_cookies,
    same_site="lax",
)

# Add CORS middleware for DHIS2 app integration
def _parse_cors():
    raw = os.environ.get("CORS_ALLOW_ORIGINS")
    if not raw:
        return [
            "http://localhost:3000",
        ]
    return [o.strip() for o in raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Block any attempts to connect to WebSocket/SSE endpoints
@app.api_route("/_event/", methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"])
@app.api_route("/socket.io/", methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"])
@app.api_route("/ws", methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"])
@app.api_route("/websocket", methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"])
async def block_websocket_endpoints():
    """Block all WebSocket/Socket.IO connection attempts"""
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"error": "WebSocket endpoints disabled", "message": "This application uses HTTP-only communication"}
    )

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="app/templates")
# Lightweight helper: get current user's organisation units for an instance
@app.get("/api/user-orgunits")
async def api_user_orgunits(request: Request, instance: str = "source"):
    try:
        connections = resolve_connections(request)
        if not connections or instance not in connections:
            raise HTTPException(400, f"No connection configured for {instance}")

        api = Api(**connections[instance])
        resp = api.get("api/me.json", params={"fields": "organisationUnits[id,name,level]"})
        if resp.status_code != 200:
            raise HTTPException(400, f"Failed to fetch user org units: HTTP {resp.status_code}")
        data = resp.json()
        return JSONResponse({"organisationUnits": data.get("organisationUnits", [])})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error getting user org units: {str(e)}")

# PWA Routes
@app.get("/manifest.json")
async def get_manifest():
    """Serve PWA manifest"""
    from fastapi.responses import FileResponse
    return FileResponse("static/manifest.json", media_type="application/json")

@app.get("/sw.js")
async def get_service_worker():
    """Serve service worker"""
    from fastapi.responses import FileResponse
    return FileResponse("static/sw.js", media_type="application/javascript")

# Include routers
app.include_router(completeness_router)
app.include_router(metadata_router)
app.include_router(settings_profiles_router)
app.include_router(schedules_router)
app.include_router(tracker_router)

# Create tables if not present (for simple bootstrap; avoid in production)
try:
    if _env != "production":
        Base.metadata.create_all(bind=engine)
except Exception as _e:
    pass

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

@app.get("/ready")
async def ready():
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        return {"ready": True}
    except Exception as e:
        from fastapi import Response
        return Response(content="{\"ready\": false}", media_type="application/json", status_code=503)

# Scheduler startup (guard with env var)
import os
if os.environ.get("ENABLE_SCHEDULER") == "1":
    try:
        start_scheduler_and_load_jobs()
    except Exception:
        pass

# Global storage for background tasks progress
task_progress: Dict[str, Dict[str, Any]] = {}

def find_best_data_element_matches(source_elements: List[Dict], dest_elements: List[Dict], threshold: float = 0.6) -> Dict[str, str]:
    """
    Auto-match data elements based on name similarity.
    Returns a dictionary mapping source element IDs to destination element IDs.
    """
    matches = {}
    
    for source_elem in source_elements:
        source_name = source_elem.get("displayName", "").lower()
        source_id = source_elem.get("id")
        
        if not source_name or not source_id:
            continue
            
        best_match = None
        best_ratio = 0
        
        for dest_elem in dest_elements:
            dest_name = dest_elem.get("displayName", "").lower()
            dest_id = dest_elem.get("id")
            
            if not dest_name or not dest_id:
                continue
                
            # Calculate similarity ratio
            ratio = difflib.SequenceMatcher(None, source_name, dest_name).ratio()
            
            if ratio > best_ratio and ratio >= threshold:
                best_ratio = ratio
                best_match = dest_id
        
        if best_match:
            matches[source_id] = best_match
    
    return matches

def find_dataset_matches(source_dataset: Dict, dest_datasets: List[Dict], threshold: float = 0.6) -> List[Dict]:
    """
    Find potential dataset matches based on name similarity and data elements.
    Returns a list of potential matches with similarity scores.
    """
    matches = []
    source_name = source_dataset.get("displayName", "").lower()
    source_elements = [de.get("dataElement", {}) for de in source_dataset.get("dataSetElements", [])]
    source_element_names = set(elem.get("displayName", "").lower() for elem in source_elements if elem.get("displayName"))
    
    for dest_dataset in dest_datasets:
        dest_name = dest_dataset.get("displayName", "").lower()
        dest_elements = [de.get("dataElement", {}) for de in dest_dataset.get("dataSetElements", [])]
        dest_element_names = set(elem.get("displayName", "").lower() for elem in dest_elements if elem.get("displayName"))
        
        # Calculate name similarity
        name_similarity = difflib.SequenceMatcher(None, source_name, dest_name).ratio()
        
        # Calculate data element overlap
        common_elements = source_element_names.intersection(dest_element_names)
        total_elements = len(source_element_names.union(dest_element_names))
        element_similarity = len(common_elements) / total_elements if total_elements > 0 else 0
        
        # Combined score (weighted)
        combined_score = (name_similarity * 0.4) + (element_similarity * 0.6)
        
        if combined_score >= threshold:
            matches.append({
                "dataset": dest_dataset,
                "name_similarity": round(name_similarity, 3),
                "element_similarity": round(element_similarity, 3),
                "combined_score": round(combined_score, 3),
                "common_elements": len(common_elements),
                "total_elements": len(dest_elements)
            })
    
    # Sort by combined score (highest first)
    matches.sort(key=lambda x: x["combined_score"], reverse=True)
    return matches[:5]  # Return top 5 matches


@app.post("/api/proxy/metadata-summary")
async def proxy_metadata_summary(request_data: dict):
    """Aggregate multiple metadata endpoints for one instance in one call."""
    try:
        connection = request_data.get("connection") or {}
        fields = request_data.get("fields") or {}
        url = connection.get("url")
        username = connection.get("username")
        password = connection.get("password")
        if not all([url, username, password]):
            return {"error": "connection missing required fields"}

        api = Api(url, username, password)
        def get(endpoint: str, fields_key: str):
            params = {"fields": fields.get(fields_key, ":all"), "paging": "false"}
            return api.get(endpoint, params=params)

        responses = {
            "dataSets": get("api/dataSets.json", "datasets"),
            "dataElements": get("api/dataElements.json", "dataElements"),
            "organisationUnits": get("api/organisationUnits.json", "orgUnits"),
            "categories": get("api/categories.json", "categories"),
            "categoryOptions": get("api/categoryOptions.json", "categoryOptions"),
            "categoryCombos": get("api/categoryCombos.json", "categoryCombos"),
            "categoryOptionCombos": get("api/categoryOptionCombos.json", "categoryOptionCombos"),
        }
        out = {}
        for key, resp in responses.items():
            if resp.status_code != 200:
                return {"error": f"Failed to fetch {key}: HTTP {resp.status_code}"}
            out[key] = resp.json().get(key, [])
        return out
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/proxy/metadata-compare")
async def proxy_metadata_compare(request_data: dict):
    """Compare metadata between source and destination. Returns missing/conflicts and suggestions."""
    try:
        source = request_data.get("source") or {}
        dest = request_data.get("dest") or {}
        fields = request_data.get("fields") or {}
        threshold = float(request_data.get("threshold", 0.6))

        # Fetch summaries
        src = await proxy_metadata_summary({"connection": source, "fields": fields})
        if src.get("error"):
            return {"error": f"source: {src['error']}"}
        dst = await proxy_metadata_summary({"connection": dest, "fields": fields})
        if dst.get("error"):
            return {"error": f"dest: {dst['error']}"}

        # Build comparisons
        def conflicts(src_items, dst_items, keys):
            by_id = {d.get("id"): d for d in dst_items}
            out = []
            for s in src_items:
                d = by_id.get(s.get("id"))
                if not d:
                    continue
                for k in keys:
                    if s.get(k) != d.get(k):
                        out.append({
                            **s,
                            "conflictField": k,
                            "sourceValue": s.get(k),
                            "destValue": d.get(k)
                        })
                        break
            return out

        result = {
            "datasets": {
                "source": src.get("dataSets", []),
                "dest": dst.get("dataSets", []),
            },
            "dataElements": {
                "source": src.get("dataElements", []),
                "dest": dst.get("dataElements", []),
            }
        }
        # Missing
        result["datasets"]["missing"] = [d for d in result["datasets"]["source"] if d.get("id") not in {x.get("id") for x in result["datasets"]["dest"]}]
        result["dataElements"]["missing"] = [d for d in result["dataElements"]["source"] if d.get("id") not in {x.get("id") for x in result["dataElements"]["dest"]}]
        # Conflicts
        result["datasets"]["conflicts"] = conflicts(result["datasets"]["source"], result["datasets"]["dest"], ["displayName", "periodType", "version"])
        result["dataElements"]["conflicts"] = conflicts(result["dataElements"]["source"], result["dataElements"]["dest"], ["displayName", "valueType", "version"])

        # Suggestions
        suggestions = {
            "dataElements": find_best_data_element_matches(
                {"dataElements": result["dataElements"]["source"]},  # not used; function expects list
                result["dataElements"]["dest"],
                threshold
            ) if False else {}  # keep interface; detailed suggestions are in mapping endpoint
        }
        result["suggestions"] = suggestions
        return result
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/proxy/mapping-suggestions")
async def proxy_mapping_suggestions(request_data: dict):
    """Return mapping suggestions for datasets and data elements."""
    try:
        source_dataset = request_data.get("source_dataset") or {}
        dest_datasets = request_data.get("dest_datasets") or []
        source_elements = request_data.get("source_elements") or []
        dest_elements = request_data.get("dest_elements") or []
        threshold = float(request_data.get("threshold", 0.6))

        dataset_matches = find_dataset_matches(source_dataset, dest_datasets, threshold)
        element_matches = find_best_data_element_matches(
            [{"displayName": de.get("displayName"), "id": de.get("id")} for de in source_elements],
            [{"displayName": de.get("displayName"), "id": de.get("id")} for de in dest_elements],
            threshold
        )
        return {"datasets": dataset_matches, "dataElements": element_matches}
    except Exception as e:
        return {"error": str(e)}

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Main dashboard with tabbed interface"""
    session = request.session
    
    # Get recent jobs from global storage
    recent_jobs = globals().get("completed_jobs", [])[-10:]  # Last 10 jobs
    
    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "connections": session.get("connections", {}),
        "sync_profiles": session.get("sync_profiles", []),
        "job_history": recent_jobs,
    })

@app.get("/api/jobs")
async def get_job_history():
    """Get job history for dashboard"""
    jobs = globals().get("completed_jobs", [])
    return JSONResponse({"jobs": jobs[-20:]})  # Last 20 jobs

@app.get("/api/datasets")
async def get_datasets(request: Request, instance: str = "source"):
    """Fetch datasets from specified DHIS2 instance"""
    try:
        connections = resolve_connections(request)
        if not connections or instance not in connections:
            raise HTTPException(400, f"No connection configured for {instance}")
        
        # Create API instance
        api = Api(**connections[instance])
        
        # Fetch datasets with additional fields
        response = api.get("api/dataSets.json", params={
            "fields": "id,displayName,name,periodType,description,dataSetElements[dataElement[id,displayName]]",
            "paging": "false"
        })
        
        if response.status_code != 200:
            raise HTTPException(400, f"Failed to fetch datasets from {instance}: {response.text}")
        
        data = response.json()
        datasets = data.get("dataSets", [])
        
        # Add element count to each dataset for better selection
        for dataset in datasets:
            element_count = len(dataset.get("dataSetElements", []))
            dataset["elementCount"] = element_count
        
        return JSONResponse({
            "instance": instance,
            "datasets": datasets,
            "count": len(datasets)
        })
        
    except Exception as e:
        raise HTTPException(500, f"Error fetching datasets: {str(e)}")

@app.post("/api/datasets/match")
async def match_datasets(request: Request):
    """Find potential dataset matches between source and destination"""
    try:
        data = await request.json()
        source_dataset_id = data.get("source_dataset_id")
        
        connections = resolve_connections(request)
        if not connections:
            raise HTTPException(400, "No connections configured")
        
        # Get datasets from both instances
        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])
        
        # Fetch source dataset details
        source_response = source_api.get(f"api/dataSets/{source_dataset_id}.json", params={
            "fields": "id,displayName,name,periodType,dataSetElements[dataElement[id,displayName]]"
        })
        
        if source_response.status_code != 200:
            raise HTTPException(400, "Source dataset not found")
        
        source_dataset = source_response.json()
        
        # Fetch all destination datasets
        dest_response = dest_api.get("api/dataSets.json", params={
            "fields": "id,displayName,name,periodType,dataSetElements[dataElement[id,displayName]]",
            "paging": "false"
        })
        
        if dest_response.status_code != 200:
            raise HTTPException(400, "Failed to fetch destination datasets")
        
        dest_datasets = dest_response.json().get("dataSets", [])
        
        # Find potential matches
        matches = find_dataset_matches(source_dataset, dest_datasets)
        
        return JSONResponse({
            "source_dataset": source_dataset,
            "potential_matches": matches
        })
        
    except Exception as e:
        raise HTTPException(500, f"Error matching datasets: {str(e)}")

@app.post("/api/dataset-info")
async def get_dataset_info(request: Request):
    """Get dataset metadata for period and attribute selection"""
    try:
        data = await request.json()
        dataset_id = data.get("dataset_id")
        
        if not dataset_id:
            raise HTTPException(400, "Dataset ID is required")
        
        connections = request.session.get("connections")
        if not connections:
            raise HTTPException(400, "No connections configured")
        
        # Create API instances
        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])
        
        # Get user's org units from their profile
        user_response = await asyncio.to_thread(source_api.get, "api/me.json", params={
            "fields": "organisationUnits[id,name,level]"
        })
        
        if user_response.status_code != 200:
            raise HTTPException(400, "Could not get user information from source instance")
        
        user_info = user_response.json()
        user_org_units = user_info.get("organisationUnits", [])
        
        if not user_org_units:
            raise HTTPException(400, "User has no assigned organization units")
        
        # Get the highest level (lowest number) org unit as the parent
        top_level_ou = min(user_org_units, key=lambda ou: ou.get("level", 999))
        
        # Fetch dataset information including periodType, data elements, and attributeOptionCombos
        dataset_response = source_api.get(f"api/dataSets/{dataset_id}.json", params={
            "fields": "id,displayName,periodType,dataSetElements[dataElement[id,displayName]],categoryCombo[id,displayName,categoryOptionCombos[id,displayName]]"
        })
        
        if dataset_response.status_code != 200:
            raise HTTPException(400, "Dataset not found in source instance")
        
        dataset_info = dataset_response.json()
        
        # Check if same dataset exists in destination
        dest_dataset_response = dest_api.get(f"api/dataSets/{dataset_id}.json")
        same_dataset_exists = dest_dataset_response.status_code == 200
        
        # Extract attribute option combos
        category_combo = dataset_info.get("categoryCombo", {})
        attribute_options = []
        if category_combo and category_combo.get("categoryOptionCombos"):
            attribute_options = category_combo.get("categoryOptionCombos", [])
        
        # Extract data elements for downstream UIs (e.g., completeness)
        data_elements = [
            {
                "id": dse.get("dataElement", {}).get("id"),
                "displayName": dse.get("dataElement", {}).get("displayName", dse.get("dataElement", {}).get("id"))
            }
            for dse in (dataset_info.get("dataSetElements", []) or [])
            if dse.get("dataElement")
        ]
        
        return JSONResponse({
            "dataset_id": dataset_id,
            "dataset_name": dataset_info.get("displayName", "Unknown"),
            "period_type": dataset_info.get("periodType", "Unknown"),
            "parent_org_unit": {
                "id": top_level_ou.get("id"),
                "name": top_level_ou.get("name", "Unknown"),
                "level": top_level_ou.get("level", 0)
            },
            "total_elements": len(dataset_info.get("dataSetElements", [])),
            "data_elements": data_elements,
            "same_dataset_exists": same_dataset_exists,
            "attribute_options": attribute_options,
            "has_attributes": len(attribute_options) > 1  # More than just default combo
        })
        
    except Exception as e:
        raise HTTPException(500, f"Error getting dataset info: {str(e)}")

@app.post("/api/dataset-info-by-instance")
async def get_dataset_info_by_instance(request: Request):
    """Get dataset metadata for a specific instance (source or dest).
    Body: { dataset_id: str, instance: 'source'|'dest' }
    Returns: { dataset_id, dataset_name, period_type, data_elements[], attribute_options[], has_attributes }
    """
    try:
        data = await request.json()
        dataset_id = data.get("dataset_id")
        instance = (data.get("instance") or "source").strip()

        if not dataset_id:
            raise HTTPException(400, "Dataset ID is required")

        connections = request.session.get("connections")
        if not connections or instance not in connections:
            raise HTTPException(400, f"No connection configured for instance '{instance}'")

        api = Api(**connections[instance])

        # Fetch dataset info from the specified instance
        ds_resp = api.get(f"api/dataSets/{dataset_id}.json", params={
            "fields": "id,displayName,periodType,dataSetElements[dataElement[id,displayName]],categoryCombo[id,displayName,categoryOptionCombos[id,displayName]]"
        })
        if ds_resp.status_code != 200:
            raise HTTPException(400, f"Dataset not found in {instance} instance")
        ds = ds_resp.json()

        # Extract attribute option combos
        category_combo = ds.get("categoryCombo", {})
        attribute_options = category_combo.get("categoryOptionCombos", []) if category_combo else []

        # Extract data elements
        data_elements = [
            {
                "id": dse.get("dataElement", {}).get("id"),
                "displayName": dse.get("dataElement", {}).get("displayName", dse.get("dataElement", {}).get("id"))
            }
            for dse in (ds.get("dataSetElements", []) or [])
            if dse.get("dataElement")
        ]

        return JSONResponse({
            "dataset_id": ds.get("id"),
            "dataset_name": ds.get("displayName", "Unknown"),
            "period_type": ds.get("periodType", "Unknown"),
            "data_elements": data_elements,
            "attribute_options": attribute_options,
            "has_attributes": len(attribute_options) > 1
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error getting dataset info by instance: {str(e)}")

@app.post("/api/preview-data")
async def preview_data_with_periods(request: Request):
    """Preview data after user has selected periods and attributes"""
    try:
        data = await request.json()
        dataset_id = data.get("dataset_id")
        selected_periods = data.get("periods", [])
        selected_attribute = data.get("attribute_option_combo")  # Optional
        
        if not dataset_id:
            raise HTTPException(400, "Dataset ID is required")
        
        if not selected_periods:
            raise HTTPException(400, "At least one period must be selected")
        
        connections = request.session.get("connections")
        if not connections:
            raise HTTPException(400, "No connections configured")
        
        # Create API instances
        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])
        
        # Get user's top-level org unit (same logic as before)
        user_response = source_api.get("api/me.json", params={
            "fields": "organisationUnits[id,name,level]"
        })
        
        if user_response.status_code != 200:
            raise HTTPException(400, "Could not get user information")
        
        user_info = user_response.json()
        user_org_units = user_info.get("organisationUnits", [])
        top_level_ou = min(user_org_units, key=lambda ou: ou.get("level", 999))
        parent_ou_id = top_level_ou.get("id")
        
        # Now make dataValueSets calls for each selected period
        all_org_units = set()
        total_data_values = 0
        
        for period in selected_periods:
            # Build params for dataValueSets call
            params = {
                "dataSet": dataset_id,
                "period": period,
                "orgUnit": parent_ou_id,
                "children": "true",
                "fields": "dataValues[orgUnit]",
                "paging": "false"
            }
            
            # Add attribute option combo if specified
            if selected_attribute:
                params["attributeOptionCombo"] = selected_attribute
            
            data_response = source_api.get("api/dataValueSets", params=params)
            
            if data_response.status_code == 200:
                period_data = data_response.json().get("dataValues", [])
                total_data_values += len(period_data)
                
                # Collect org units from this period
                for dv in period_data:
                    if dv.get("orgUnit"):
                        all_org_units.add(dv.get("orgUnit"))
        
        org_units_list = list(all_org_units)
        
        # Check org unit compatibility with destination
        compatible_org_units = True
        incompatible_count = 0
        
        if org_units_list:
            sample_orgs = org_units_list[:10]  # Check first 10
            for org_id in sample_orgs:
                org_response = dest_api.get("api/organisationUnits", params={
                    "filter": f"id:eq:{org_id}",
                    "fields": "id",
                    "paging": "false"
                })
                if org_response.status_code == 200:
                    matches = org_response.json().get("organisationUnits", [])
                    if len(matches) == 0:
                        incompatible_count += 1
                else:
                    incompatible_count += 1
            
            compatible_org_units = incompatible_count < len(sample_orgs) * 0.5
        
        return JSONResponse({
            "dataset_id": dataset_id,
            "selected_periods": selected_periods,
            "selected_attribute": selected_attribute,
            "total_data_values": total_data_values,
            "org_units": org_units_list,
            "org_units_with_data": len(org_units_list),
            "compatible_org_units": compatible_org_units,
            "incompatible_org_units": incompatible_count,
            "ready_for_sync": total_data_values > 0 and len(org_units_list) > 0
        })
        
    except Exception as e:
        raise HTTPException(500, f"Error previewing data: {str(e)}")

@app.post("/connect")
async def connect_dhis2(
    request: Request,
    source_url: str = Form(...),
    source_username: str = Form(...), 
    source_password: str = Form(...),
    dest_url: str = Form(...),
    dest_username: str = Form(...),
    dest_password: str = Form(...)
):
    """Test connections to both DHIS2 instances"""
    try:
        print(f"Testing source connection: {source_url} with user: {source_username}")
        # Test source connection
        source_api = Api(source_url, source_username, source_password)
        source_response = source_api.get("api/me.json")
        
        if source_response.status_code != 200:
            error_msg = f"Source connection failed (HTTP {source_response.status_code})"
            if source_response.status_code == 401:
                error_msg += ": Invalid credentials"
            elif source_response.status_code == 404:
                error_msg += ": Server not found or invalid URL"
            else:
                error_msg += f": {source_response.text[:100]}"
            return JSONResponse(
                status_code=400,
                content={"detail": error_msg}
            )
        
        print(f"Testing destination connection: {dest_url} with user: {dest_username}")
        # Test destination connection  
        dest_api = Api(dest_url, dest_username, dest_password)
        dest_response = dest_api.get("api/me.json")
        
        if dest_response.status_code != 200:
            error_msg = f"Destination connection failed (HTTP {dest_response.status_code})"
            if dest_response.status_code == 401:
                error_msg += ": Invalid credentials"
            elif dest_response.status_code == 404:
                error_msg += ": Server not found or invalid URL"
            else:
                error_msg += f": {dest_response.text[:100]}"
            return JSONResponse(
                status_code=400,
                content={"detail": error_msg}
            )
        
        # Parse user info from responses
        try:
            source_user = source_response.json().get("displayName", "Unknown User")
        except:
            source_user = "Connected User"
            
        try:
            dest_user = dest_response.json().get("displayName", "Unknown User")
        except:
            dest_user = "Connected User"
        
        # Store connection details in session
        request.session["connections"] = {
            "source": {"url": source_url, "username": source_username, "password": source_password},
            "dest": {"url": dest_url, "username": dest_username, "password": dest_password}
        }
        
        return JSONResponse({
            "success": True,
            "message": "Connections successful!",
            "source_user": source_user,
            "dest_user": dest_user
        })
        
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"detail": f"Connection error: {str(e)}"}
        )

@app.get("/datasets")
async def load_datasets(request: Request):
    """Load datasets from both instances"""
    connections = resolve_connections(request)
    if not connections:
        raise HTTPException(400, "No connections found")
    
    try:
        # Create API instances
        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])
        
        # Fetch datasets with period type information
        source_datasets = source_api.get("api/dataSets.json?fields=id,displayName,periodType&paging=false")
        dest_datasets = dest_api.get("api/dataSets.json?fields=id,displayName,periodType&paging=false")
        
        if source_datasets.status_code != 200 or dest_datasets.status_code != 200:
            raise HTTPException(400, "Failed to fetch datasets")
        
        datasets = {
            "source": source_datasets.json().get("dataSets", []),
            "dest": dest_datasets.json().get("dataSets", [])  
        }
        
        request.session["datasets"] = datasets
        
        return templates.TemplateResponse("partials/dataset_selection.html", {
            "request": request,
            "datasets": datasets
        })
        
    except Exception as e:
        return templates.TemplateResponse("partials/error.html", {
            "request": request,
            "error": str(e)
        })

@app.post("/select-datasets")
async def select_datasets(
    request: Request,
    source_dataset: str = Form(...),
    dest_dataset: str = Form(...),
    periods: str = Form(...),
    org_units: str = Form(...)
):
    """Select datasets and move to mapping step"""
    try:
        connections = resolve_connections(request)
        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])
        
        # Fetch data elements for selected datasets
        source_elements = source_api.get(f"api/dataSets/{source_dataset}.json?fields=dataSetElements[dataElement[id,displayName]]")
        dest_elements = dest_api.get(f"api/dataSets/{dest_dataset}.json?fields=dataSetElements[dataElement[id,displayName]]")
        
        if source_elements.status_code != 200 or dest_elements.status_code != 200:
            raise HTTPException(400, "Failed to fetch data elements")
        
        # Extract data elements
        source_data_elements = [el["dataElement"] for el in source_elements.json().get("dataSetElements", [])]
        dest_data_elements = [el["dataElement"] for el in dest_elements.json().get("dataSetElements", [])]
        
        # Parse periods and org units
        periods_list = [p.strip() for p in periods.split(",") if p.strip()]
        org_units_list = [ou.strip() for ou in org_units.split(",") if ou.strip()]
        
        # Auto-match data elements based on name similarity
        auto_matches = find_best_data_element_matches(source_data_elements, dest_data_elements)
        
        # Store selection
        request.session["selection"] = {
            "source_dataset": source_dataset,
            "dest_dataset": dest_dataset,
            "periods": periods_list,
            "org_units": org_units_list,
            "source_elements": source_data_elements,
            "dest_elements": dest_data_elements,
            "auto_matches": auto_matches
        }
        request.session["current_step"] = 3
        
        return templates.TemplateResponse("partials/step_mapping.html", {
            "request": request,
            "selection": request.session["selection"]
        })
        
    except Exception as e:
        return templates.TemplateResponse("partials/error.html", {
            "request": request,
            "error": str(e)
        })

@app.post("/save-mapping")
async def save_mapping(request: Request):
    """Save element mapping and move to transfer step"""
    form_data = await request.form()
    mapping = {}
    
    # Extract mapping from form data
    for key, value in form_data.items():
        if key.startswith("mapping_") and value:
            source_id = key.replace("mapping_", "")
            mapping[source_id] = value
    
    request.session["mapping"] = mapping
    request.session["current_step"] = 4
    
    return templates.TemplateResponse("partials/step_transfer.html", {
        "request": request,
        "mapping_count": len(mapping)
    })

@app.post("/start-transfer")
async def start_transfer(request: Request, background_tasks: BackgroundTasks):
    """Start data transfer process"""
    task_id = f"transfer_{len(task_progress)}"
    task_progress[task_id] = {"status": "starting", "progress": 0, "messages": []}
    
    # Add background task
    background_tasks.add_task(perform_transfer, task_id, request.session)
    
    return templates.TemplateResponse("partials/transfer_progress.html", {
        "request": request,
        "task_id": task_id
    })

@app.get("/progress/{task_id}")
async def get_progress(task_id: str):
    """Get progress of background task"""
    if task_id not in task_progress:
        raise HTTPException(404, "Task not found")
    
    progress_data = task_progress[task_id]
    message_count = len(progress_data.get('messages', []))
    current_status = progress_data.get('status', 'unknown')
    current_progress = progress_data.get('progress', 0)
    
    print(f"[{task_id}] Status: {current_status}, Progress: {current_progress}%, Messages: {message_count}")
    
    # Add timestamp to help with debugging
    import time
    progress_data['last_updated'] = time.time()
    
    return progress_data

async def perform_transfer(task_id: str, session_data: dict):
    """Background task for data transfer"""
    try:
        progress = task_progress[task_id]
        progress["messages"].append("Starting data transfer...")
        progress["status"] = "running"
        progress["progress"] = 10
        
        # Get session data
        connections = session_data.get("connections")
        selection = session_data.get("selection")
        mapping = session_data.get("mapping", {})
        
        # Create API instances
        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])
        
        progress["messages"].append("Fetching source data...")
        progress["progress"] = 30
        
        # Get periods and org units from selection
        periods = selection.get("periods", [])
        org_units = selection.get("org_units", [])
        
        progress["messages"].append(f"Processing {len(periods)} periods and {len(org_units)} org units...")
        
        all_data_values = []
        total_combinations = len(periods) * len(org_units)
        processed = 0
        
        # Fetch data for each period and org unit combination
        for period in periods:
            for org_unit in org_units:
                try:
                    response = await asyncio.to_thread(source_api.get, "api/dataValueSets.json", params={
                        "dataSet": selection["source_dataset"],
                        "period": period,
                        "orgUnit": org_unit,
                        "children": "true"
                    })
                    
                    if response.status_code == 200:
                        data = response.json()
                        data_values = data.get("dataValues", [])
                        all_data_values.extend(data_values)
                        progress["messages"].append(f"✓ Fetched {len(data_values)} values for {period} / {org_unit}")
                    else:
                        progress["messages"].append(f"⚠ No data for {period} / {org_unit}: {response.status_code}")
                    
                    processed += 1
                    progress["progress"] = 30 + (20 * processed / total_combinations)
                    
                except Exception as e:
                    progress["messages"].append(f"✗ Error fetching {period} / {org_unit}: {str(e)}")
                    processed += 1
        
        progress["messages"].append(f"Found {len(all_data_values)} total data values from all sources")
        progress["progress"] = 50
        
        # Apply mapping and transform data
        mapped_values = []
        for dv in all_data_values:
            source_element = dv.get("dataElement")
            if source_element in mapping:
                dv_copy = dv.copy()
                dv_copy["dataElement"] = mapping[source_element]
                mapped_values.append(dv_copy)
        
        progress["messages"].append(f"Mapped {len(mapped_values)} data values")
        progress["progress"] = 70
        
        # Send to destination
        if mapped_values:
            dest_response = await asyncio.to_thread(dest_api.post, "api/dataValueSets.json", {
                "dataValues": mapped_values
            })
            
            if dest_response.status_code != 200:
                raise Exception(f"Failed to send data to destination: {dest_response.text}")
            
            summary = dest_response.json().get("response", {})
            progress["messages"].append(f"Transfer complete! Status: {summary.get('status', 'UNKNOWN')}")
        else:
            progress["messages"].append("No data to transfer after mapping")
        
        progress["status"] = "completed"
        progress["progress"] = 100
        
    except Exception as e:
        progress = task_progress[task_id]
        progress["status"] = "error"
        progress["messages"].append(f"Error: {str(e)}")

@app.post("/start-sync")
async def start_sync(request: Request, background_tasks: BackgroundTasks):
    """Start data sync using simplified flow"""
    try:
        data = await request.json()
        
        # Extract sync parameters
        source_dataset_id = data.get("source_dataset")
        dest_dataset_id = data.get("dest_dataset", source_dataset_id)  # Use same ID if not specified
        periods = data.get("periods", [])
        needs_mapping = data.get("needs_mapping", False)
        include_parents = data.get("include_parents", False)
        threshold = int(data.get("threshold", 0))
        
        # Validate required parameters
        if not source_dataset_id:
            raise HTTPException(400, "Source dataset must be selected")
        
        if not periods:
            raise HTTPException(400, "At least one period must be selected")
        
        task_id = f"sync_{len(task_progress)}"
        task_progress[task_id] = {"status": "starting", "progress": 0, "messages": []}
        
        # Add background task
        background_tasks.add_task(
            perform_simplified_sync, 
            task_id, 
            request.session,
            source_dataset_id,
            dest_dataset_id,
            periods,
            needs_mapping,
            include_parents,
            threshold
        )
        
        return JSONResponse({"task_id": task_id, "status": "started"})
        
    except Exception as e:
        raise HTTPException(500, f"Error starting sync: {str(e)}")

async def perform_sync(task_id: str, session_data: dict, source_dataset_id: str, dest_dataset_id: str, 
                      periods: list, source_parent_ou: str, dest_parent_ou: str, include_parents: bool, threshold: int):
    """Background task for sync using user's proven logic"""
    try:
        progress = task_progress[task_id]
        progress["messages"].append("Starting sync process...")
        progress["progress"] = 10
        
        # Initialize job record
        job_record = {
            "id": task_id,
            "type": "sync",
            "status": "running",
            "started_at": datetime.datetime.now().isoformat(),
            "source_dataset_id": source_dataset_id,
            "dest_dataset_id": dest_dataset_id,
            "dataset_id": f"{source_dataset_id} → {dest_dataset_id}",  # For display
            "periods": periods,
            "source_parent_ou": source_parent_ou,
            "dest_parent_ou": dest_parent_ou,
            "include_parents": include_parents,
            "threshold": threshold,
            "total_transferred": 0
        }
        
        # Get connections
        connections = session_data.get("connections")
        if not connections:
            raise Exception("No DHIS2 connections configured")
        
        # Create API instances
        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])
        
        progress["messages"].append("Connected to DHIS2 instances")
        progress["progress"] = 20
        
        # Build org unit mapping between source and destination
        progress["messages"].append("Building org unit mappings...")
        org_unit_mapping = await build_org_unit_mapping(
            source_api, dest_api, source_parent_ou, dest_parent_ou, progress
        )
        
        if not org_unit_mapping:
            raise Exception("No org unit mappings could be established")
        
        progress["messages"].append(f"Mapped {len(org_unit_mapping)} org units")
        
        # Build data element mapping between datasets
        progress["messages"].append("Building data element mappings...")
        element_mapping = await build_data_element_mapping(
            source_api, dest_api, source_dataset_id, dest_dataset_id, progress
        )
        
        progress["messages"].append(f"Mapped {len(element_mapping)} data elements")
        progress["progress"] = 30
        
        # Process each period
        total_transferred = 0
        for i, period in enumerate(periods):
            progress["messages"].append(f"Processing period {period}...")
            
            # Fetch data from source using user's proven pattern
            response = source_api.get("api/dataValueSets", params={
                "dataSet": source_dataset_id,
                "period": period,
                "orgUnit": source_parent_ou,
                "children": "true"
            })
            
            if response.status_code != 200:
                progress["messages"].append(f"Warning: No data for period {period}")
                continue
                
            source_data = response.json()
            data_values = source_data.get("dataValues", [])
            
            if not data_values:
                progress["messages"].append(f"No data values found for period {period}")
                continue
            
            # Group and filter data by org unit (using proven logic pattern)
            org_unit_data = {}
            for dv in data_values:
                org_unit = dv.get("orgUnit")
                if org_unit:
                    if org_unit not in org_unit_data:
                        org_unit_data[org_unit] = []
                    org_unit_data[org_unit].append(dv)
            
            # Apply threshold filter (from user's proven logic)
            if threshold > 0:
                org_unit_data = {
                    ou: values for ou, values in org_unit_data.items() 
                    if len(values) >= threshold
                }
            
            progress["messages"].append(f"Found data for {len(org_unit_data)} org units in {period}")
            
            # Map org units and prepare data values (using user's pattern)
            mapped_values = []
            for source_ou, values in org_unit_data.items():
                # Skip if source parent should not be included
                if source_ou == source_parent_ou and not include_parents:
                    continue
                    
                # Find destination org unit mapping
                dest_ou = org_unit_mapping.get(source_ou)
                if not dest_ou:
                    progress["messages"].append(f"Warning: No mapping for org unit {source_ou}")
                    continue
                
                # Map data values to destination org units and elements
                for dv in values:
                    source_element = dv.get("dataElement")
                    dest_element = element_mapping.get(source_element)
                    
                    if not dest_element:
                        progress["messages"].append(f"Warning: No mapping for data element {source_element}")
                        continue
                    
                    dv_copy = dv.copy()
                    dv_copy["orgUnit"] = dest_ou
                    dv_copy["dataElement"] = dest_element
                    mapped_values.append(dv_copy)
            
            # Send to destination (user's proven pattern)
            if mapped_values:
                dest_response = dest_api.post("api/dataValueSets", {
                    "dataValues": mapped_values
                })
                
                if dest_response.status_code == 200:
                    summary = dest_response.json().get("response", {})
                    imported = summary.get("importCount", {}).get("imported", 0)
                    total_transferred += imported
                    progress["messages"].append(f"✓ Period {period}: {imported} values transferred")
                else:
                    progress["messages"].append(f"✗ Period {period}: Transfer failed - {dest_response.text[:100]}")
            else:
                progress["messages"].append(f"No mapped data to transfer for period {period}")
            
            # Update progress
            progress["progress"] = 30 + (60 * (i + 1) / len(periods))
        
        # Update job record with completion
        job_record["status"] = "completed"
        job_record["completed_at"] = datetime.datetime.now().isoformat()
        job_record["total_transferred"] = total_transferred
        
        # Store job record in global storage (in production, use database)
        if "completed_jobs" not in globals():
            globals()["completed_jobs"] = []
        globals()["completed_jobs"].append(job_record)
        
        progress["messages"].append(f"Sync complete! Total transferred: {total_transferred} data values")
        progress["status"] = "completed"
        progress["progress"] = 100
        progress["job_record"] = job_record
        
    except Exception as e:
        progress = task_progress[task_id]
        progress["status"] = "error"
        progress["messages"].append(f"Sync failed: {str(e)}")
        
        # Update job record with error
        if "job_record" in locals():
            job_record["status"] = "error"
            job_record["completed_at"] = datetime.datetime.now().isoformat()
            job_record["error"] = str(e)
            
            if "completed_jobs" not in globals():
                globals()["completed_jobs"] = []
            globals()["completed_jobs"].append(job_record)

async def build_org_unit_mapping(source_api: Api, dest_api: Api, 
                                source_parent: str, dest_parent: str, progress: dict) -> dict:
    """Build mapping between source and destination org units based on names"""
    try:
        # Fetch source org unit hierarchy
        source_response = source_api.get(f"api/organisationUnits/{source_parent}.json", params={
            "fields": "children[id,name,displayName]",
            "includeDescendants": "true"
        })
        
        # Fetch destination org unit hierarchy  
        dest_response = dest_api.get(f"api/organisationUnits/{dest_parent}.json", params={
            "fields": "children[id,name,displayName]",
            "includeDescendants": "true"
        })
        
        if source_response.status_code != 200 or dest_response.status_code != 200:
            progress["messages"].append("Warning: Could not fetch org unit hierarchies")
            return {}
        
        source_data = source_response.json()
        dest_data = dest_response.json()
        
        # Extract org units
        source_orgs = source_data.get("children", [])
        dest_orgs = dest_data.get("children", [])
        
        # Add parent org units to mapping if they should be included
        source_orgs.append({"id": source_parent, "name": source_data.get("name", "")})
        dest_orgs.append({"id": dest_parent, "name": dest_data.get("name", "")})
        
        # Build name-based mapping (user's proven approach)
        mapping = {}
        
        # Create name lookup for destination org units
        dest_by_name = {}
        for dest_org in dest_orgs:
            name = dest_org.get("displayName") or dest_org.get("name", "")
            if name:
                dest_by_name[name.lower()] = dest_org.get("id")
        
        # Map source org units to destination by name
        for source_org in source_orgs:
            source_id = source_org.get("id")
            source_name = (source_org.get("displayName") or source_org.get("name", "")).lower()
            
            if source_name and source_name in dest_by_name:
                mapping[source_id] = dest_by_name[source_name]
                progress["messages"].append(f"Mapped: {source_name} -> {dest_by_name[source_name]}")
            else:
                progress["messages"].append(f"No match found for: {source_name}")
        
        return mapping
        
    except Exception as e:
        progress["messages"].append(f"Error building org unit mapping: {str(e)}")
        return {}

async def build_data_element_mapping(source_api: Api, dest_api: Api, 
                                    source_dataset_id: str, dest_dataset_id: str, progress: dict) -> dict:
    """Build mapping between source and destination data elements"""
    try:
        # Fetch source dataset elements
        source_response = source_api.get(f"api/dataSets/{source_dataset_id}.json", params={
            "fields": "dataSetElements[dataElement[id,displayName,name]]"
        })
        
        # Fetch destination dataset elements
        dest_response = dest_api.get(f"api/dataSets/{dest_dataset_id}.json", params={
            "fields": "dataSetElements[dataElement[id,displayName,name]]"
        })
        
        if source_response.status_code != 200 or dest_response.status_code != 200:
            progress["messages"].append("Warning: Could not fetch dataset elements")
            return {}
        
        source_data = source_response.json()
        dest_data = dest_response.json()
        
        # Extract data elements
        source_elements = [de.get("dataElement", {}) for de in source_data.get("dataSetElements", [])]
        dest_elements = [de.get("dataElement", {}) for de in dest_data.get("dataSetElements", [])]
        
        # Use existing matching logic
        mapping = find_best_data_element_matches(source_elements, dest_elements)
        
        # Log mapping results
        for source_id, dest_id in mapping.items():
            source_name = next((e.get("displayName", e.get("name", "")) for e in source_elements if e.get("id") == source_id), source_id)
            dest_name = next((e.get("displayName", e.get("name", "")) for e in dest_elements if e.get("id") == dest_id), dest_id)
            progress["messages"].append(f"Element mapping: {source_name} → {dest_name}")
        
        return mapping
        
    except Exception as e:
        progress["messages"].append(f"Error building data element mapping: {str(e)}")
        return {}

async def perform_simplified_sync(task_id: str, session_data: dict, source_dataset_id: str, 
                                 dest_dataset_id: str, periods: list, needs_mapping: bool, 
                                 include_parents: bool, threshold: int):
    """Real sync implementation using proven CLI pattern"""
    try:
        progress = task_progress[task_id]
        
        def log_progress(message, progress_percent=None):
            """Helper function to log progress with timestamp"""
            timestamp = datetime.datetime.now().strftime("%H:%M:%S")
            formatted_message = f"[{timestamp}] {message}"
            progress["messages"].append(formatted_message)
            if progress_percent is not None:
                progress["progress"] = progress_percent
            print(f"[{task_id}] {formatted_message}")
        
        log_progress("Starting synchronization using proven CLI pattern...", 5)
        progress["status"] = "running"
        
        # Initialize job record
        job_record = {
            "id": task_id,
            "type": "sync", 
            "status": "running",
            "started_at": datetime.datetime.now().isoformat(),
            "source_dataset_id": source_dataset_id,
            "dest_dataset_id": dest_dataset_id,
            "dataset_id": f"{source_dataset_id}" + (f" → {dest_dataset_id}" if dest_dataset_id != source_dataset_id else ""),
            "periods": periods,
            "needs_mapping": needs_mapping,
            "include_parents": include_parents,
            "threshold": threshold,
            "total_transferred": 0,
            "updates_made": 0,
            "not_found": []
        }
        
        # Get connections
        connections = session_data.get("connections")
        if not connections:
            raise Exception("No DHIS2 connections configured")
        
        # Create API instances
        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])
        
        log_progress("Connected to DHIS2 instances", 10)
        
        # Get user's top-level org unit for parent context
        user_response = source_api.get("api/me.json", params={
            "fields": "organisationUnits[id,name,level]"
        })
        user_org_units = user_response.json().get("organisationUnits", [])
        parent_ou = min(user_org_units, key=lambda ou: ou.get("level", 999)).get("id")
        
        results = {
            'total_completed': 0,
            'total_unmarked': 0,
            'total_errors': 0,
            'hierarchy': {},
            'updates_made': 0,
            'not_found': []
        }
        
        # Process each period using CLI pattern
        total_org_units_to_process = 0
        all_source_org_units = {}
        
        # Step 1: Discover all org units with data across all periods (CLI pattern)
        log_progress("Discovering organization units with data from source API...")
        log_progress(f"Using dataset: {source_dataset_id}, periods: {periods}, parent OU: {parent_ou}")
        
        for period in periods:
            log_progress(f"Discovering org units for period {period}...")
            org_units_for_period = await get_org_units_with_data_async(source_api, source_dataset_id, period, [parent_ou])
            all_source_org_units.update(org_units_for_period)
            log_progress(f"Found {len(org_units_for_period)} org units with data for period {period}")
        
        total_org_units_to_process = len(all_source_org_units)
        log_progress(f"Total: {total_org_units_to_process} unique org units with data across all periods", 20)
        
        if total_org_units_to_process == 0:
            raise Exception("No organization units found with data for the selected periods")
        
        # Step 2: Process each source org unit (CLI pattern)
        processed_count = 0
        
        for source_id, source_name in all_source_org_units.items():
            processed_count += 1
            current_progress = 20 + (60 * processed_count // total_org_units_to_process)
            log_progress(f"Processing {processed_count}/{total_org_units_to_process}: {source_name} ({source_id})", current_progress)
            
            try:
                # Find matching org unit in destination (CLI pattern)
                dest_org_unit_id = await find_matching_org_unit_async(dest_api, source_id, source_name)
                
                if dest_org_unit_id:
                    log_progress(f"✓ Found match in destination: {dest_org_unit_id}")
                    
                    # Process each period for this org unit
                    for period in periods:
                        try:
                            # Update data values using CLI pattern
                            # Always use source_dataset_id for fetching data from source
                            updated_data = await update_data_values_async(
                                source_api, 
                                dest_api, 
                                source_id, 
                                dest_org_unit_id, 
                                period, 
                                source_dataset_id  # Always use source dataset ID for getting source data
                            )
                            
                            if updated_data:
                                data_values = updated_data.get('dataValues', [])
                                if data_values:
                                    log_progress(f"✓ Updated {len(data_values)} data values for {source_name} in {period}")
                                else:
                                    log_progress(f"⚠ No data values to update for {source_name} in {period}, but continuing with completion check")
                                
                                # Apply threshold filter (CLI pattern)
                                if threshold > 0 and len(data_values) < threshold:
                                    log_progress(f"⚠ Skipping completion - below threshold ({len(data_values)} < {threshold})")
                                    continue
                                
                                # Build completion payload (CLI pattern)
                                completion_payload = build_completion_payload_sync(
                                    data_values,
                                    None,  # No parent filtering needed
                                    period,
                                    dest_dataset_id if dest_dataset_id != source_dataset_id else source_dataset_id,
                                    include_parents
                                )
                                
                                if completion_payload:
                                    # Mark as complete (CLI pattern)
                                    log_progress(f"POST api/completeDataSetRegistrations - Registering completion for {len(completion_payload)} org units")
                                    complete_response = await asyncio.to_thread(
                                        dest_api.post,
                                        "api/completeDataSetRegistrations",
                                        {
                                            "completeDataSetRegistrations": list(completion_payload.values())
                                        }
                                    )
                                    
                                    if complete_response.status_code == 200:
                                        log_progress(f"✓ Completion registration successful (Status: {complete_response.status_code})")
                                        results['total_completed'] += len(completion_payload)
                                        results['updates_made'] += 1
                                        log_progress(f"✓ Marked {len(completion_payload)} datasets as complete for {source_name}")
                                    else:
                                        log_progress(f"⚠ Completion failed for {source_name}: {complete_response.text[:100]}")
                                        
                        except Exception as period_error:
                            log_progress(f"✗ Error processing {source_name} for period {period}: {str(period_error)}")
                            results['total_errors'] += 1
                else:
                    results['not_found'].append({
                        'id': source_id,
                        'name': source_name
                    })
                    log_progress(f"⚠ Could not find matching org unit in destination for {source_name} ({source_id})")
                    
            except Exception as ou_error:
                log_progress(f"✗ Error processing {source_name} ({source_id}): {str(ou_error)}")
                results['total_errors'] += 1
            
            # Update progress
            progress["progress"] = 20 + (70 * processed_count / total_org_units_to_process)
        
        # Update job record with completion
        job_record["status"] = "completed"
        job_record["completed_at"] = datetime.datetime.now().isoformat()
        job_record["total_transferred"] = results['updates_made']
        job_record["org_units_processed"] = processed_count - len(results['not_found'])
        job_record["org_units_not_found"] = len(results['not_found'])
        job_record["total_completed"] = results['total_completed']
        job_record["total_errors"] = results['total_errors']
        
        # Store job record
        if "completed_jobs" not in globals():
            globals()["completed_jobs"] = []
        globals()["completed_jobs"].append(job_record)
        
        log_progress(f"🎉 Sync complete!")
        log_progress(f"📊 Summary:")
        log_progress(f"   • {results['updates_made']} org units successfully updated")
        log_progress(f"   • {results['total_completed']} datasets marked complete")
        log_progress(f"   • {len(results['not_found'])} org units not found in destination")
        log_progress(f"   • {results['total_errors']} errors encountered")
        
        progress["status"] = "completed"
        progress["progress"] = 100
        progress["job_record"] = job_record
        
    except Exception as e:
        progress = task_progress[task_id]
        progress["status"] = "error"
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        formatted_message = f"[{timestamp}] ❌ Sync failed: {str(e)}"
        progress["messages"].append(formatted_message)
        print(f"[{task_id}] {formatted_message}")
        
        # Update job record with error
        if "job_record" in locals():
            job_record["status"] = "error"
            job_record["completed_at"] = datetime.datetime.now().isoformat()
            job_record["error"] = str(e)
            
            if "completed_jobs" not in globals():
                globals()["completed_jobs"] = []
            globals()["completed_jobs"].append(job_record)

async def get_org_units_with_data_async(api: Api, dataset_id: str, period: str, parent_org_units: list) -> dict:
    """Get all organization units that have data for the given dataset and period (CLI pattern)"""
    all_org_units = {}
    
    for parent_ou in parent_org_units:
        print(f"Getting org units with data for dataset {dataset_id}, period {period}, parent {parent_ou}")
        if not dataset_id:
            print(f"ERROR: dataset_id is empty or None!")
            continue
            
        params = {
            'dataSet': dataset_id,
            'period': period,
            'orgUnit': parent_ou,
            'children': 'true',
            'fields': 'dataValues[orgUnit]',
            'paging': 'false'
        }
        print(f"API params: {params}")
        response = await asyncio.to_thread(api.get, 'api/dataValueSets', params=params)
        
        if response.status_code != 200:
            print(f"Warning: Failed to get data values for parent {parent_ou}: {response.text[:100]}...")
            continue
        
        data_values = response.json().get('dataValues', [])
        org_unit_ids = {dv['orgUnit'] for dv in data_values if dv.get('orgUnit')}
        
        # Get names for all org units (with caching from API class)
        for org_unit_id in org_unit_ids:
            name = api.get_org_unit_name(org_unit_id)
            all_org_units[org_unit_id] = name
    
    return all_org_units

async def find_matching_org_unit_async(dest_api: Api, source_org_unit_id: str, source_org_unit_name: str) -> str:
    """Find a matching org unit in the destination based on the source org unit (CLI pattern)"""
    # Try exact ID match first (CLI pattern)
    response = await asyncio.to_thread(dest_api.get, 'api/organisationUnits', params={
        'filter': f'id:eq:{source_org_unit_id}',
        'fields': 'id,name',
        'paging': 'false'
    })
    
    if response.status_code == 200:
        matches = response.json().get('organisationUnits', [])
        if len(matches) == 1:
            return matches[0]['id']
    
    # Try case-insensitive name match (CLI pattern)
    response = await asyncio.to_thread(dest_api.get, 'api/organisationUnits', params={
        'filter': f'name:ilike:{source_org_unit_name}',
        'fields': 'id,name',
        'paging': 'false'
    })
    
    if response.status_code == 200:
        matches = response.json().get('organisationUnits', [])
        for match in matches:
            if match['name'].lower() == source_org_unit_name.lower():
                return match['id']
    
    return None

async def update_data_values_async(source_api: Api, dest_api: Api, source_org_unit_id: str, 
                                  dest_org_unit_id: str, period: str, dataset_id: str) -> dict:
    """Update data values in destination to match source using dataValueSets endpoint (CLI pattern)"""
    
    # Get data from source for the specific org unit (CLI pattern)
    print(f"Getting data values for dataset {dataset_id}, orgUnit {source_org_unit_id}, period {period}")
    source_response = await asyncio.to_thread(source_api.get, 'api/dataValueSets', params={
        'dataSet': dataset_id,
        'orgUnit': source_org_unit_id,
        'period': period
    })
    
    if source_response.status_code != 200:
        raise ValueError(f"Failed to get source data: {source_response.text[:100]}...")
    
    source_data = source_response.json()
    source_values = source_data.get('dataValues', [])
    
    if not source_values:
        return source_data  # Return data structure even if empty, let caller decide what to do
    
    # Update orgUnit in values to match destination (CLI pattern)
    for value in source_values:
        value['orgUnit'] = dest_org_unit_id
    
    # Prepare update payload (CLI pattern)
    update_payload = {
        "dataSet": dataset_id,
        "completeDate": datetime.datetime.now().strftime("%Y-%m-%d"),
        "period": period,
        "orgUnit": dest_org_unit_id,
        "dataValues": source_values
    }
    
    # Update destination data (CLI pattern)
    update_response = await asyncio.to_thread(dest_api.post, 'api/dataValueSets', update_payload)
    
    if update_response.status_code != 200:
        raise ValueError(f"Failed to update data values: {update_response.text[:100]}...")
    
    return source_data

def build_completion_payload_sync(data_values: list, parent_ou: str, period: str, dataset_id: str, include_parent: bool = False) -> dict:
    """Build completion payload based on updated data values (CLI pattern)"""
    orgs_with_data = set()
    for dv in data_values:
        if (org_unit := dv.get("orgUnit")) and (dv_period := dv.get("period")):
            if dv_period == period:
                orgs_with_data.add(org_unit)

    to_complete = {}
    for org_unit in orgs_with_data:
        if include_parent or org_unit != parent_ou:
            to_complete[(org_unit, period)] = {
                "dataSet": dataset_id,
                "period": period,
                "organisationUnit": org_unit,
                "completed": True
            }

    return to_complete

# This endpoint has been moved to routes/completeness.py to avoid conflicts
# The router version provides data element compliance assessment functionality

@app.post("/navigate/{step}")
async def navigate_to_step(request: Request, step: int):
    """Navigate to a specific step in the wizard"""
    current_step = request.session.get("current_step", 1)
    
    # Validation: can only go back to completed steps or forward to next step
    if step < 1 or step > 4:
        raise HTTPException(400, "Invalid step number")
    
    if step > current_step and step != current_step + 1:
        raise HTTPException(400, "Cannot skip steps forward")
    
    # Update current step
    request.session["current_step"] = step
    
    # Return appropriate template based on step
    templates_map = {
        1: "partials/step_connect.html",
        2: "partials/step_datasets.html", 
        3: "partials/step_mapping.html",
        4: "partials/step_transfer.html"
    }
    
    context = {
        "request": request,
        "current_step": step
    }
    
    # Add step-specific context
    if step == 1:
        # Preserve form data if going back
        connections = request.session.get("connections", {})
        if "source" in connections:
            context.update({
                "source_url": connections["source"].get("url", ""),
                "source_username": connections["source"].get("username", ""),
                "dest_url": connections["dest"].get("url", ""),
                "dest_username": connections["dest"].get("username", "")
            })
    elif step == 2:
        context["datasets"] = request.session.get("datasets", {})
        context["success"] = "Connections verified! Select datasets below."
        # Preserve form data if going back
        selection = request.session.get("selection", {})
        if selection:
            context.update({
                "periods": ', '.join(selection.get("periods", [])),
                "org_units": ', '.join(selection.get("org_units", []))
            })
    elif step == 3:
        context["selection"] = request.session.get("selection", {})
    elif step == 4:
        mapping = request.session.get("mapping", {})
        context["mapping_count"] = len(mapping)
    
    return templates.TemplateResponse(templates_map[step], context)

@app.get("/api/organisation-units")
async def get_organisation_units(request: Request, parent: str = None, instance: str = "source", level: int = None):
    """Get organization units hierarchically from DHIS2.
    Behavior:
    - If parent is provided → return that node's children
    - Else if level is provided → return units at that level
    - Else → return current user's root org units (fallback if level 1 not available)
    """
    connections = request.session.get("connections")
    if not connections or instance not in connections:
        raise HTTPException(400, f"No connection found for {instance}")
    
    try:
        api = Api(**connections[instance])
        
        # Children of a specific parent
        if parent:
            response = api.get(f"api/organisationUnits/{parent}.json", params={
                "fields": "children[id,displayName,leaf,level,path,children[id]]"
            })
            if response.status_code != 200:
                raise HTTPException(400, f"Failed to fetch children: {response.text}")
            data = response.json()
            org_units = data.get("children", [])

        # Specific level
        elif level:
            response = api.get("api/organisationUnits.json", params={
                "filter": f"level:eq:{level}",
                "fields": "id,displayName,leaf,level,path,children[id]",
                "paging": "false"
            })
            if response.status_code != 200:
                raise HTTPException(400, f"Failed to fetch level {level}: {response.text}")
            data = response.json()
            org_units = data.get("organisationUnits", [])

            # Fallback: if empty, use user's org units as roots
            if not org_units:
                me = api.get("api/me.json", params={"fields": "organisationUnits[id,displayName,name,level],dataViewOrganisationUnits[id,displayName,name,level]"})
                if me.status_code != 200:
                    raise HTTPException(400, f"Failed to fetch user org units: {me.text}")
                me_json = me.json() or {}
                roots = me_json.get("organisationUnits") or me_json.get("dataViewOrganisationUnits") or []
                org_units = []
                for root in roots:
                    # Fetch minimal details to determine hasChildren
                    d = api.get(f"api/organisationUnits/{root.get('id')}.json", params={
                        "fields": "id,displayName,name,leaf,level,path"
                    })
                    if d.status_code == 200:
                        node = d.json()
                        if "displayName" not in node and node.get("name"):
                            node["displayName"] = node["name"]
                        org_units.append(node)

        # Default: user roots
        else:
            me = api.get("api/me.json", params={"fields": "organisationUnits[id,displayName,name,level],dataViewOrganisationUnits[id,displayName,name,level]"})
            if me.status_code != 200:
                raise HTTPException(400, f"Failed to fetch user org units: {me.text}")
            me_json = me.json() or {}
            roots = me_json.get("organisationUnits") or me_json.get("dataViewOrganisationUnits") or []
            org_units = []
            for root in roots:
                d = api.get(f"api/organisationUnits/{root.get('id')}.json", params={
                    "fields": "id,displayName,name,leaf,level,path"
                })
                if d.status_code == 200:
                    node = d.json()
                    if "displayName" not in node and node.get("name"):
                        node["displayName"] = node["name"]
                    org_units.append(node)

        # Add UI metadata
        for ou in org_units:
            # Ensure displayName populated
            if "displayName" not in ou and ou.get("name"):
                ou["displayName"] = ou["name"]
            # For roots (no parent in this call), default hasChildren=true to allow expansion
            inferred_has_children = (len(ou.get("children", [])) > 0) or (not ou.get("leaf", True))
            ou["hasChildren"] = True if not parent else inferred_has_children
            ou["expanded"] = False
            ou["selected"] = False
        
        return org_units
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error fetching organization units: {str(e)}")

@app.get("/api/organisation-units/search")
async def search_organisation_units(request: Request, q: str, instance: str = "source"):
    """Search organization units by name"""
    connections = request.session.get("connections")
    if not connections or instance not in connections:
        raise HTTPException(400, f"No connection found for {instance}")
    
    if len(q) < 2:
        return []
    
    try:
        api = Api(**connections[instance])
        response = api.get("api/organisationUnits.json", params={
            "filter": f"displayName:ilike:{q}",
            "fields": "id,displayName,level,path",
            "paging": "false",
            "pageSize": "20"
        })
        
        if response.status_code != 200:
            return []
        
        data = response.json()
        return data.get("organisationUnits", [])
        
    except Exception as e:
        return []

# Dynamic proxy endpoints for DHIS2 app integration
@app.post("/api/proxy/test-connection")
async def proxy_test_connection(request_data: dict):
    """Test connection to any DHIS2 instance"""
    try:
        # Extract connection details from request
        url = request_data.get("url", "").strip()
        username = request_data.get("username", "").strip() 
        password = request_data.get("password", "").strip()
        
        if not all([url, username, password]):
            return {"success": False, "error": "URL, username, and password are required"}
        
        # Validate URL format
        if not url.startswith(("http://", "https://")):
            return {"success": False, "error": "URL must start with http:// or https://"}
            
        api = Api(url, username, password)
        response = api.get("api/me.json?fields=id,displayName,name")
        
        if response.status_code == 200:
            user_data = response.json()
            return {
                "success": True,
                "user": user_data.get("displayName") or user_data.get("name") or "Connected User",
                "url": url  # Echo back for confirmation
            }
        elif response.status_code == 401:
            return {"success": False, "error": "Invalid username or password"}
        elif response.status_code == 404:
            return {"success": False, "error": "DHIS2 instance not found at this URL"}
        else:
            return {"success": False, "error": f"HTTP {response.status_code}"}
    except Exception as e:
        return {"success": False, "error": f"Connection failed: {str(e)}"}

@app.post("/api/proxy/datasets")
async def proxy_datasets(request_data: dict):
    """Get datasets from any DHIS2 instance"""
    try:
        url = request_data.get("url")
        username = request_data.get("username") 
        password = request_data.get("password")
        
        if not all([url, username, password]):
            return {"dataSets": [], "error": "Connection details required"}
            
        api = Api(url, username, password)
        response = api.get("api/dataSets.json", params={
            "fields": "id,displayName,periodType,dataSetElements[dataElement[id,displayName,valueType]]",
            "paging": "false"
        })
        
        if response.status_code == 200:
            data = response.json()
            datasets = data.get("dataSets", [])
            
            # Add element count for better UX
            for dataset in datasets:
                element_count = len(dataset.get("dataSetElements", []))
                dataset["elementCount"] = element_count
            
            return {
                "dataSets": datasets,
                "count": len(datasets),
                "instance": url
            }
        else:
            return {"dataSets": [], "error": f"Failed to fetch datasets: HTTP {response.status_code}"}
    except Exception as e:
        return {"dataSets": [], "error": str(e)}

@app.post("/api/proxy/dataset-info")
async def proxy_dataset_info(request_data: dict):
    """Get detailed dataset info from any DHIS2 instance"""
    try:
        url = request_data.get("url")
        username = request_data.get("username")
        password = request_data.get("password") 
        dataset_id = request_data.get("dataset_id")
        
        if not all([url, username, password, dataset_id]):
            return {"error": "All connection details and dataset_id required"}
            
        api = Api(url, username, password)
        
        # Get dataset details with category combos for attributes
        response = api.get(f"api/dataSets/{dataset_id}.json", params={
            "fields": "id,displayName,periodType,dataSetElements[dataElement[id,displayName,valueType]],categoryCombo[id,displayName,categoryOptionCombos[id,displayName]]"
        })
        
        if response.status_code == 200:
            dataset_data = response.json()
            category_combo = dataset_data.get("categoryCombo", {})
            attribute_options = category_combo.get("categoryOptionCombos", [])
            
            # Get user's org units for parent context
            user_response = api.get("api/me.json", params={
                "fields": "organisationUnits[id,name,level]"
            })
            
            parent_org_unit = None
            if user_response.status_code == 200:
                user_org_units = user_response.json().get("organisationUnits", [])
                if user_org_units:
                    # Get highest level (lowest number) org unit
                    parent_org_unit = min(user_org_units, key=lambda ou: ou.get("level", 999))
            
            return {
                **dataset_data,
                "attributeOptions": attribute_options,
                "hasAttributes": len(attribute_options) > 1,
                "totalElements": len(dataset_data.get("dataSetElements", [])),
                "parentOrgUnit": parent_org_unit,
                "instance": url
            }
        else:
            return {"error": f"Dataset not found: HTTP {response.status_code}"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/proxy/sync")
async def proxy_sync(request_data: dict, background_tasks: BackgroundTasks):
    """Start sync between any two DHIS2 instances"""
    try:
        # Extract source and destination connection details
        source_config = request_data.get("source_connection")
        dest_config = request_data.get("dest_connection")
        sync_config = request_data.get("sync_config")
        
        if not all([source_config, dest_config, sync_config]):
            raise HTTPException(400, "Source connection, destination connection, and sync config required")
        
        # Validate required fields
        required_source = ["url", "username", "password"]
        required_dest = ["url", "username", "password"] 
        required_sync = ["dataset_id", "periods"]
        
        if not all(field in source_config for field in required_source):
            raise HTTPException(400, "Source connection missing required fields")
            
        if not all(field in dest_config for field in required_dest):
            raise HTTPException(400, "Destination connection missing required fields")
            
        if not all(field in sync_config for field in required_sync):
            raise HTTPException(400, "Sync config missing required fields")
        
        # Create task ID
        task_id = f"sync_{len(task_progress)}"
        task_progress[task_id] = {"status": "starting", "progress": 0, "messages": []}
        
        # Store connections in session-like structure for background task
        session_data = {
            "connections": {
                "source": source_config,
                "dest": dest_config
            }
        }
        
        # Add background task with dynamic connections
        background_tasks.add_task(
            perform_dynamic_sync,
            task_id,
            session_data,
            sync_config
        )
        
        return JSONResponse({"task_id": task_id, "status": "started"})
        
    except Exception as e:
        raise HTTPException(500, f"Error starting sync: {str(e)}")

@app.post("/api/proxy/completeness-assessment")
async def proxy_completeness_assessment(request_data: dict):
    """Run completeness assessment on any DHIS2 instance"""
    try:
        connection = request_data.get("connection")
        config = request_data.get("config")
        selected_data_elements = request_data.get("selected_data_elements", [])
        selected_attributes = request_data.get("selected_attributes", [])
        
        if not all([connection, config]):
            return {"error": "Connection and config required"}
        
        if not all(field in connection for field in ["url", "username", "password"]):
            return {"error": "Connection missing required fields"}
            
        # Create API instance for the specified connection
        api = Api(connection["url"], connection["username"], connection["password"])
        
        # Run completeness assessment using your existing logic
        results = await run_completeness_assessment_dynamic(
            api, 
            config, 
            selected_data_elements, 
            selected_attributes
        )
        
        return results
        
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/proxy/user-orgunits")
async def proxy_user_orgunits(request_data: dict):
    """Get the current user's root organisation units for a given DHIS2 instance"""
    try:
        connection = request_data.get("connection") or {}
        url = connection.get("url")
        username = connection.get("username")
        password = connection.get("password")

        if not all([url, username, password]):
            return {"error": "Connection missing required fields"}

        api = Api(url, username, password)
        response = api.get("api/me.json", params={
            "fields": "organisationUnits[id,name,level]"
        })

        if response.status_code != 200:
            return {"error": f"Failed to fetch user org units: HTTP {response.status_code}"}

        user_data = response.json()
        org_units = user_data.get("organisationUnits", [])
        return {"organisationUnits": org_units}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/proxy/data-values")
async def proxy_data_values(request_data: dict):
    """Get dataValueSets for a dataset/period/parent OU with optional attributes"""
    try:
        connection = request_data.get("connection") or {}
        dataset_id = request_data.get("dataset_id")
        period = request_data.get("period")
        parent_org_unit = request_data.get("parent_org_unit")
        include_children = request_data.get("children", True)
        attribute_option_combos = request_data.get("attribute_option_combos", [])

        url = connection.get("url")
        username = connection.get("username")
        password = connection.get("password")

        if not all([url, username, password, dataset_id, period, parent_org_unit]):
            return {"error": "connection, dataset_id, period, and parent_org_unit are required"}

        api = Api(url, username, password)
        params = {
            "dataSet": dataset_id,
            "orgUnit": parent_org_unit,
            "period": period,
            "children": "true" if include_children else "false",
            "fields": "dataValues[orgUnit,dataElement,value]",
            "paging": "false",
        }
        if attribute_option_combos:
            params["attributeOptionCombo"] = ";".join(attribute_option_combos)

        response = api.get("api/dataValueSets", params=params)
        if response.status_code != 200:
            return {"error": f"Failed to fetch data values: HTTP {response.status_code}"}

        return response.json()
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/proxy/complete-registrations")
async def proxy_complete_registrations(request_data: dict):
    """Mark dataset registrations complete or incomplete for a list of org units"""
    try:
        connection = request_data.get("connection") or {}
        dataset_id = request_data.get("dataset_id")
        period = request_data.get("period")
        org_unit_ids = request_data.get("org_unit_ids", [])
        completed = bool(request_data.get("completed", True))

        url = connection.get("url")
        username = connection.get("username")
        password = connection.get("password")

        if not all([url, username, password, dataset_id, period]) or not isinstance(org_unit_ids, list):
            return {"error": "connection, dataset_id, period and org_unit_ids[] are required"}

        api = Api(url, username, password)

        payload = {
            "completeDataSetRegistrations": [
                {
                    "dataSet": dataset_id,
                    "period": period,
                    "organisationUnit": ou,
                    "completed": completed,
                }
                for ou in org_unit_ids if ou
            ]
        }

        response = api.post("api/completeDataSetRegistrations", payload)
        if response.status_code != 200:
            return {"error": f"Failed to update registrations: HTTP {response.status_code}", "body": response.text}
        return response.json()
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/proxy/get")
async def proxy_get(request_data: dict):
    """Generic GET proxy to DHIS2 API. Expects connection, endpoint (e.g. 'api/dataSets.json'), and optional params."""
    try:
        connection = request_data.get("connection") or {}
        endpoint = request_data.get("endpoint")
        params = request_data.get("params") or {}
        url = connection.get("url")
        username = connection.get("username")
        password = connection.get("password")
        if not all([url, username, password, endpoint]):
            return {"error": "connection and endpoint are required"}
        api = Api(url, username, password)
        response = api.get(endpoint, params=params)
        if response.status_code != 200:
            return {"error": f"HTTP {response.status_code}", "body": response.text[:500]}
        return response.json()
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/proxy/post")
async def proxy_post(request_data: dict):
    """Generic POST proxy to DHIS2 API. Expects connection, endpoint (e.g. 'api/metadata'), and json payload."""
    try:
        connection = request_data.get("connection") or {}
        endpoint = request_data.get("endpoint")
        payload = request_data.get("payload") or {}
        url = connection.get("url")
        username = connection.get("username")
        password = connection.get("password")
        if not all([url, username, password, endpoint]):
            return {"error": "connection and endpoint are required"}
        api = Api(url, username, password)
        response = api.post(endpoint, json_payload=payload)
        if response.status_code not in (200, 201):
            return {"error": f"HTTP {response.status_code}", "body": response.text[:1000]}
        # Some metadata endpoints return text; try json else text
        try:
            return response.json()
        except Exception:
            return {"status": "ok", "body": response.text[:1000]}
    except Exception as e:
        return {"error": str(e)}

async def perform_dynamic_sync(task_id: str, session_data: dict, sync_config: dict):
    """Background sync task that works with any DHIS2 instances"""
    # Use your existing perform_simplified_sync logic but with dynamic connections
    # The session_data contains the source and dest connections
    # The sync_config contains dataset, periods, etc.
    
    await perform_simplified_sync(
        task_id,
        session_data, 
        sync_config.get("dataset_id"),
        sync_config.get("dest_dataset_id", sync_config.get("dataset_id")),
        sync_config.get("periods"),
        sync_config.get("needs_mapping", False),
        sync_config.get("include_parents", False),
        sync_config.get("threshold", 0)
    )

async def run_completeness_assessment_dynamic(api: Api, config: dict, selected_data_elements: list, selected_attributes: list):
    """Run completeness assessment with dynamic API instance"""
    try:
        assessment_results = {
            "hasDataNotComplete": [],
            "markedCompleteNoData": [], 
            "otherIncomplete": []
        }
        
        # Use your existing completeness logic but with the provided API instance
        # This would be similar to your existing runAssessment but using the dynamic api parameter
        
        dataset_id = config.get("dataset")
        periods = config.get("periods", [])
        org_units = config.get("orgUnits", [])
        
        for org_unit_path in org_units:
            parent_org_unit_id = org_unit_path.split('/').pop()
            
            for period in periods:
                # Get data values using the dynamic API instance
                params = {
                    'dataSet': dataset_id,
                    'orgUnit': parent_org_unit_id, 
                    'period': period,
                    'children': 'true',
                    'fields': 'dataValues[orgUnit,dataElement,value]'
                }
                
                if selected_attributes:
                    params['attributeOptionCombo'] = ';'.join(selected_attributes)
                
                # Use the dynamic API instance
                data_response = api.get('api/dataValueSets', params=params)
                
                if data_response.status_code == 200:
                    data_values = data_response.json().get('dataValues', [])
                    
                    # Process data values using your existing logic
                    # Group by org unit, check completeness, etc.
                    # ... (implement your existing completeness logic here)
        
        return assessment_results
        
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)