from fastapi import APIRouter, Request, Form, BackgroundTasks, HTTPException
from fastapi.templating import Jinja2Templates
from typing import List, Optional
import json
import time

from ..dhis2_api import Api, complete_datasets, assess_data_element_compliance
from ..conn_utils import resolve_connections
from ..models import CompletenessConfig, CompletenessResult
from ..db import SessionLocal
from ..models_db import TaskProgress

router = APIRouter(prefix="/completeness", tags=["completeness"])
templates = Jinja2Templates(directory="app/templates")

# Global storage for completeness tasks (kept for in-memory speed)
completeness_progress = {}

def _save_progress(task_id: str, payload: dict, task_type: str):
    """Persist task progress to DB (TaskProgress)."""
    db = SessionLocal()
    try:
        row = db.query(TaskProgress).filter(TaskProgress.id == task_id).first()
        messages = payload.get("messages")
        results = payload.get("results")
        if not row:
            row = TaskProgress(
                id=task_id,
                task_type=task_type,
                status=payload.get("status", "starting"),
                progress=int(payload.get("progress", 0)),
                messages=json.dumps(messages) if isinstance(messages, list) else None,
                results=json.dumps(results) if results is not None else None,
            )
            db.add(row)
        else:
            row.status = payload.get("status", row.status)
            if "progress" in payload:
                row.progress = int(payload.get("progress", row.progress))
            if messages is not None:
                row.messages = json.dumps(messages)
            if results is not None:
                row.results = json.dumps(results)
        db.commit()
    finally:
        db.close()

def _load_progress(task_id: str) -> dict:
    db = SessionLocal()
    try:
        row = db.query(TaskProgress).filter(TaskProgress.id == task_id).first()
        if not row:
            return None
        out = {
            "status": row.status,
            "progress": row.progress,
            "messages": json.loads(row.messages) if row.messages else [],
        }
        if row.results:
            try:
                out["results"] = json.loads(row.results)
            except Exception:
                out["results"] = None
        return out
    finally:
        db.close()

@router.get("/")
async def completeness_dashboard(request: Request):
    """Completeness assessment dashboard"""
    connections = resolve_connections(request)
    
    return templates.TemplateResponse("completeness/dashboard.html", {
        "request": request,
        "connections": connections
    })

@router.post("/assess")
async def assess_completeness(request: Request):
    """Start completeness assessment with JSON payload"""
    try:
        data = await request.json()
        
        # Extract parameters
        instance = data.get("comp_instance")
        dataset_id = data.get("comp_dataset_id")
        periods = data.get("comp_periods", [])
        parent_org_units = data.get("comp_parent_ou", [])
        required_elements = data.get("comp_required_elements", [])
        compliance_threshold = data.get("comp_compliance_threshold", 100)
        include_parents = data.get("comp_include_parents", False)
        
        # Validate required parameters
        if not instance:
            raise HTTPException(400, "Instance must be specified")
        if not dataset_id:
            raise HTTPException(400, "Dataset ID is required")
        if not periods:
            raise HTTPException(400, "At least one period is required")
        if not parent_org_units:
            raise HTTPException(400, "At least one parent organization unit is required")
            
        # If no required elements provided, default to all data elements in the dataset
        if not required_elements:
            try:
                ds_resp = Api(**request.session.get("connections")[instance]).get(
                    f"api/dataSets/{dataset_id}.json",
                    params={"fields": "dataSetElements[dataElement[id]]"}
                )
                if ds_resp.status_code == 200:
                    required_elements = [
                        dse.get("dataElement", {}).get("id")
                        for dse in (ds_resp.json().get("dataSetElements", []) or [])
                        if dse.get("dataElement")
                    ]
                if not required_elements:
                    raise HTTPException(400, "Dataset has no data elements to assess")
            except Exception:
                raise HTTPException(400, "Failed to determine required elements; please select at least one")
        
        connections = resolve_connections(request)
        if instance not in connections:
            raise HTTPException(400, f"No connection found for {instance}")
        
        # Create API instance and run data element-based compliance assessment
        api = Api(**connections[instance])
        
        # Run data element compliance assessment for all periods
        all_results = {
            'total_compliant': 0,
            'total_non_compliant': 0, 
            'total_errors': 0,
            'hierarchy': {},
            'compliance_details': {}
        }
        
        for period in periods:
            period_results = assess_data_element_compliance(
                parent_org_units=parent_org_units,
                period=period,
                dataset_id=dataset_id,
                required_elements=required_elements,
                compliance_threshold=compliance_threshold,
                api=api,
                include_parents=include_parents
            )
            
            # Aggregate results
            all_results['total_compliant'] += period_results.get('total_compliant', 0)
            all_results['total_non_compliant'] += period_results.get('total_non_compliant', 0)
            all_results['total_errors'] += period_results.get('total_errors', 0)
            
            # Merge hierarchy data
            for parent_id, parent_data in period_results.get('hierarchy', {}).items():
                if parent_id not in all_results['hierarchy']:
                    all_results['hierarchy'][parent_id] = parent_data.copy()
                else:
                    # Merge children and unmarked lists
                    existing = all_results['hierarchy'][parent_id]
                    if 'compliant' in parent_data:
                        existing.setdefault('compliant', []).extend(parent_data['compliant'])
                    if 'non_compliant' in parent_data:
                        existing.setdefault('non_compliant', []).extend(parent_data['non_compliant'])
                    # Keep backward compatibility with old keys
                    if 'children' in parent_data:
                        existing.setdefault('children', []).extend(parent_data['children'])
                    if 'unmarked' in parent_data:
                        existing.setdefault('unmarked', []).extend(parent_data['unmarked'])
            
            # Merge compliance details
            all_results['compliance_details'].update(period_results.get('compliance_details', {}))
        
        return all_results
        
    except Exception as e:
        raise HTTPException(500, f"Completeness assessment failed: {str(e)}")


@router.post("/assess-bg")
async def assess_completeness_background(request: Request, background_tasks: BackgroundTasks):
    """Start completeness assessment as a background job with progress polling.
    Body is the same as /assess.
    Returns: { task_id }
    """
    try:
        data = await request.json()

        instance = data.get("comp_instance")
        dataset_id = data.get("comp_dataset_id")
        periods = data.get("comp_periods", [])
        parent_org_units = data.get("comp_parent_ou", [])
        required_elements = data.get("comp_required_elements", [])
        compliance_threshold = data.get("comp_compliance_threshold", 100)
        include_parents = data.get("comp_include_parents", False)

        if not all([instance, dataset_id]) or not periods or not parent_org_units:
            raise HTTPException(400, "Missing required parameters for assessment")

        connections = resolve_connections(request)
        if instance not in connections:
            raise HTTPException(400, f"No connection found for {instance}")

        task_id = f"comp_{len(completeness_progress)}"
        completeness_progress[task_id] = {
            "status": "starting",
            "progress": 0,
            "messages": ["Starting completeness assessment..."],
        }
        _save_progress(task_id, completeness_progress[task_id], task_type="completeness")

        # Default required elements to all in dataset if none selected
        if not required_elements:
            try:
                ds_resp = Api(**connections[instance]).get(
                    f"api/dataSets/{dataset_id}.json",
                    params={"fields": "dataSetElements[dataElement[id]]"}
                )
                if ds_resp.status_code == 200:
                    required_elements = [
                        dse.get("dataElement", {}).get("id")
                        for dse in (ds_resp.json().get("dataSetElements", []) or [])
                        if dse.get("dataElement")
                    ]
            except Exception:
                pass

        background_tasks.add_task(
            _run_compliance_multi_period,
            task_id,
            connections[instance],
            dataset_id,
            periods,
            parent_org_units,
            required_elements,
            int(compliance_threshold),
            bool(include_parents),
        )

        return {"task_id": task_id, "status": "started"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to start background assessment: {str(e)}")


def _run_compliance_multi_period(
    task_id: str,
    connection: dict,
    dataset_id: str,
    periods: list,
    parent_org_units: list,
    required_elements: list,
    threshold: int,
    include_parents: bool,
):
    try:
        progress = completeness_progress[task_id]
        progress["status"] = "running"

        api = Api(**connection)
        total = max(1, len(periods))

        results = {
            'total_compliant': 0,
            'total_non_compliant': 0,
            'total_errors': 0,
            'hierarchy': {},
            'compliance_details': {}
        }

        start_ts = time.time()
        for i, period in enumerate(periods, start=1):
            progress["messages"].append(f"Assessing {period} ({i}/{len(periods)})...")
            period_results = assess_data_element_compliance(
                parent_org_units=parent_org_units,
                period=period,
                dataset_id=dataset_id,
                required_elements=required_elements,
                compliance_threshold=threshold,
                api=api,
                include_parents=include_parents
            )
            results['total_compliant'] += period_results.get('total_compliant', 0)
            results['total_non_compliant'] += period_results.get('total_non_compliant', 0)
            results['total_errors'] += period_results.get('total_errors', 0)
            # Add a concise summary line for this period to help UI diagnostics
            pc = period_results.get('total_compliant', 0)
            pn = period_results.get('total_non_compliant', 0)
            pe = period_results.get('total_errors', 0)
            progress["messages"].append(f"{period}: compliant={pc}, non_compliant={pn}, errors={pe}")

            for parent_id, parent_data in period_results.get('hierarchy', {}).items():
                if parent_id not in results['hierarchy']:
                    results['hierarchy'][parent_id] = parent_data.copy()
                else:
                    existing = results['hierarchy'][parent_id]
                    if 'compliant' in parent_data:
                        existing.setdefault('compliant', []).extend(parent_data['compliant'])
                    if 'non_compliant' in parent_data:
                        existing.setdefault('non_compliant', []).extend(parent_data['non_compliant'])
                    if 'children' in parent_data:
                        existing.setdefault('children', []).extend(parent_data['children'])
                    if 'unmarked' in parent_data:
                        existing.setdefault('unmarked', []).extend(parent_data['unmarked'])

            results['compliance_details'].update(period_results.get('compliance_details', {}))
            progress["progress"] = int(100 * i / total)
            # Trim messages to avoid uncontrolled growth
            if len(progress.get("messages", [])) > 500:
                progress["messages"] = progress["messages"][-500:]
            _save_progress(task_id, progress, task_type="completeness")
            # Yield a little CPU to keep app responsive
            time.sleep(0.01)

        progress["messages"].append("Assessment complete")
        progress["status"] = "completed"
        progress["results"] = results
        progress["progress"] = 100
        _save_progress(task_id, progress, task_type="completeness")
    except Exception as e:
        p = completeness_progress.get(task_id, {})
        p["status"] = "error"
        p.setdefault("messages", []).append(f"Error: {str(e)}")
        completeness_progress[task_id] = p
        _save_progress(task_id, p, task_type="completeness")


@router.get("/export/{task_id}")
async def export_completeness_results(task_id: str, fmt: str = "json", limit: int = 0):
    """Export results for an assessment task.
    fmt=json (default) or csv. Use limit>0 to truncate compliance_details entries for quick previews.
    """
    if task_id not in completeness_progress:
        # Fall back to DB if not in-memory
        db_payload = _load_progress(task_id)
        if db_payload is None:
            raise HTTPException(404, "Task not found")
        return db_payload
    task = completeness_progress[task_id]
    if task.get("status") != "completed" or not task.get("results"):
        raise HTTPException(400, "Assessment not completed or no results available")

    results = task["results"]
    if limit and isinstance(results.get("compliance_details"), dict):
        # Shallow truncate for preview
        clipped = dict(list(results["compliance_details"].items())[:limit])
        results = {**results, "compliance_details": clipped}

    if fmt == "json":
        return results

    if fmt == "csv":
        # Minimal CSV: parentId,orgUnitId,name,compliance_percentage,elements_present,elements_required
        import csv
        from io import StringIO
        buf = StringIO()
        w = csv.writer(buf)
        w.writerow(["orgUnitId","name","compliance_percentage","elements_present","elements_required"]) 
        for ou_id, info in (results.get("compliance_details", {}) or {}).items():
            w.writerow([
                ou_id,
                info.get("name",""),
                info.get("compliance_percentage",0),
                info.get("elements_present",0),
                info.get("elements_required",0),
            ])
        return buf.getvalue()

    raise HTTPException(400, "Unsupported format")

@router.get("/progress/{task_id}")
async def get_completeness_progress(task_id: str):
    """Get progress of completeness assessment"""
    if task_id not in completeness_progress:
        db_payload = _load_progress(task_id)
        if db_payload is None:
            raise HTTPException(404, "Task not found")
        return db_payload
    
    return completeness_progress[task_id]

@router.get("/results/{task_id}")
async def view_completeness_results(request: Request, task_id: str):
    """View completeness assessment results"""
    if task_id not in completeness_progress:
        raise HTTPException(404, "Task not found")
    
    task_data = completeness_progress[task_id]
    if task_data["status"] != "completed" or not task_data["results"]:
        raise HTTPException(400, "Assessment not completed or no results available")
    
    return templates.TemplateResponse("completeness/results.html", {
        "request": request,
        "results": task_data["results"],
        "task_id": task_id
    })

@router.post("/bulk-action")
async def bulk_completeness_action(request: Request):
    """Perform bulk completion/incompletion action"""
    try:
        form_data = await request.form()
        
        # Extract form parameters
        action = form_data.get("action")  # 'complete' or 'incomplete'
        org_units_json = form_data.get("org_units")
        dataset_id = form_data.get("dataset_id")
        periods_str = form_data.get("periods")
        instance = form_data.get("instance")
        
        # Validate parameters
        if not action or action not in ['complete', 'incomplete']:
            raise HTTPException(400, "Action must be 'complete' or 'incomplete'")
        
        if not org_units_json:
            raise HTTPException(400, "Organization units are required")
            
        try:
            org_unit_list = json.loads(org_units_json)
        except json.JSONDecodeError:
            raise HTTPException(400, "Invalid org units format")
        
        if not dataset_id:
            raise HTTPException(400, "Dataset ID is required")
            
        if not periods_str:
            raise HTTPException(400, "Periods are required")
            
        if not instance:
            raise HTTPException(400, "Instance is required")
        
        # Parse periods
        periods = [p.strip() for p in periods_str.split(',') if p.strip()]
        
        # Get connection
        connections = resolve_connections(request)
        if instance not in connections:
            raise HTTPException(400, f"No connection found for {instance}")
        
        api = Api(**connections[instance])
        
        # Perform bulk action
        results = {
            "action": action,
            "total_processed": 0,
            "successful": [],
            "failed": []
        }
        
        for org_unit_id in org_unit_list:
            for period in periods:
                try:
                    if action == 'complete':
                        # Mark as complete
                        payload = {
                            "completeDataSetRegistrations": [{
                                "dataSet": dataset_id,
                                "period": period,
                                "organisationUnit": org_unit_id,
                                "completed": True
                            }]
                        }
                        response = api.post("api/completeDataSetRegistrations", payload)
                    else:
                        # Prefer DELETE semantics when available; fall back to POST completed:false
                        # Try DELETE endpoint first
                        delete_resp = api.delete(
                            "api/completeDataSetRegistrations",
                            params={
                                "dataSet": dataset_id,
                                "period": period,
                                "orgUnit": org_unit_id,
                            },
                        )
                        if delete_resp.status_code == 200:
                            response = delete_resp
                        else:
                            # Fallback: POST with completed False
                            response = api.post("api/completeDataSetRegistrations", {
                                "completeDataSetRegistrations": [{
                                    "dataSet": dataset_id,
                                    "period": period,
                                    "organisationUnit": org_unit_id,
                                    "completed": False
                                }]
                            })
                    
                    if response.status_code == 200:
                        results["successful"].append(f"{org_unit_id}:{period}")
                    else:
                        results["failed"].append(f"{org_unit_id}:{period} - {response.text[:100]}")
                    
                    results["total_processed"] += 1
                    
                except Exception as e:
                    results["failed"].append(f"{org_unit_id}:{period} - {str(e)}")
                    results["total_processed"] += 1
        
        return results
        
    except Exception as e:
        raise HTTPException(500, f"Bulk action failed: {str(e)}")

@router.post("/bulk-action-bg")
async def bulk_completeness_action_background(request: Request, background_tasks: BackgroundTasks):
    """Start bulk completion/incompletion as a background job with progress.
    Body (JSON): { action: 'complete'|'incomplete', org_units: [ids], dataset_id: str, periods: [str], instance: 'source'|'dest' }
    Returns: { task_id }
    """
    try:
        data = await request.json()
        action = data.get("action")
        org_units = data.get("org_units") or []
        dataset_id = data.get("dataset_id")
        periods = data.get("periods") or []
        instance = data.get("instance")

        if action not in ["complete", "incomplete"]:
            raise HTTPException(400, "Action must be 'complete' or 'incomplete'")
        if not org_units:
            raise HTTPException(400, "Organization units are required")
        if not dataset_id:
            raise HTTPException(400, "Dataset ID is required")
        if not periods:
            raise HTTPException(400, "Periods are required")
        if not instance:
            raise HTTPException(400, "Instance is required")

        connections = resolve_connections(request)
        if instance not in connections:
            raise HTTPException(400, f"No connection found for {instance}")

        bulk_task_id = f"bulk_{len(completeness_progress)}"
        completeness_progress[bulk_task_id] = {
            "status": "starting",
            "progress": 0,
            "messages": [f"Starting bulk {action} for {len(org_units)} org units across {len(periods)} period(s) ..."],
            "results": {"successful": [], "failed": [], "total_processed": 0}
        }
        _save_progress(bulk_task_id, completeness_progress[bulk_task_id], task_type="bulk_completeness")

        background_tasks.add_task(
            _run_bulk_action,
            bulk_task_id,
            connections[instance],
            dataset_id,
            periods,
            org_units,
            action,
        )

        return {"task_id": bulk_task_id, "status": "started"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to start background bulk action: {str(e)}")

async def perform_completeness_assessment(
    task_id: str,
    connection: dict,
    dataset_id: str,
    period: str,
    parent_org_units: List[str],
    threshold: int,
    include_parents: bool
):
    """Background task for completeness assessment"""
    try:
        progress = completeness_progress[task_id]
        progress["messages"].append("Starting completeness assessment...")
        progress["progress"] = 10
        
        # Create API instance
        api = Api(**connection)
        
        progress["messages"].append(f"Assessing {len(parent_org_units)} parent organization units...")
        progress["progress"] = 30
        
        # Run completeness assessment using your existing CLI logic
        results = complete_datasets(
            parent_org_units,
            period,
            dataset_id,
            api,
            include_parents,
            threshold
        )
        
        progress["messages"].append(f"Assessment completed!")
        progress["messages"].append(f"Total completed: {results['total_completed']}")
        progress["messages"].append(f"Total unmarked: {results['total_unmarked']}")
        progress["messages"].append(f"Total errors: {results['total_errors']}")
        
        progress["status"] = "completed"
        progress["progress"] = 100
        progress["results"] = results
        
    except Exception as e:
        progress = completeness_progress[task_id]
        progress["status"] = "error"
        progress["messages"].append(f"Error: {str(e)}")

async def perform_bulk_action(
    bulk_task_id: str,
    source_task_id: str,
    action: str,
    org_unit_list: List[str]
):
    """Background task for bulk completion actions"""
    try:
        progress = completeness_progress[bulk_task_id]
        source_task = completeness_progress[source_task_id]
        
        progress["messages"].append(f"Starting bulk {action} action...")
        progress["progress"] = 20
        
        # This would implement bulk completion/incompletion
        # For now, simulate the process
        import asyncio
        
        for i, org_unit in enumerate(org_unit_list):
            await asyncio.sleep(0.1)  # Simulate processing time
            progress["progress"] = 20 + (70 * (i + 1) / len(org_unit_list))
            progress["messages"].append(f"Processed {org_unit}")
        
        progress["status"] = "completed"
        progress["progress"] = 100
        progress["messages"].append(f"Bulk {action} completed for {len(org_unit_list)} org units")
        
    except Exception as e:
        progress = completeness_progress[bulk_task_id]
        progress["status"] = "error"
        progress["messages"].append(f"Error: {str(e)}")

def _run_bulk_action(
    task_id: str,
    connection: dict,
    dataset_id: str,
    periods: List[str],
    org_units: List[str],
    action: str,
):
    """Background worker to perform actual bulk complete/incomplete with progress updates."""
    try:
        progress = completeness_progress[task_id]
        progress["status"] = "running"
        api = Api(**connection)

        total_steps = max(1, len(org_units) * len(periods))
        processed = 0
        successful: List[str] = []
        failed: List[str] = []

        for ou in org_units:
            for period in periods:
                try:
                    if action == "complete":
                        payload = {
                            "completeDataSetRegistrations": [{
                                "dataSet": dataset_id,
                                "period": period,
                                "organisationUnit": ou,
                                "completed": True
                            }]
                        }
                        resp = api.post("api/completeDataSetRegistrations", payload)
                    else:
                        # Mark as incomplete by sending completed False
                        resp = api.post("api/completeDataSetRegistrations", {
                            "completeDataSetRegistrations": [{
                                "dataSet": dataset_id,
                                "period": period,
                                "organisationUnit": ou,
                                "completed": False
                            }]
                        })

                    if resp.status_code == 200:
                        successful.append(f"{ou}:{period}")
                        progress["messages"].append(f"✓ {action} {ou} {period}")
                    else:
                        failed.append(f"{ou}:{period} - {resp.text[:120]}")
                        progress["messages"].append(f"✗ {action} {ou} {period} -> {resp.status_code}")
                except Exception as e:
                    failed.append(f"{ou}:{period} - {str(e)}")
                    progress["messages"].append(f"✗ {action} {ou} {period} - {str(e)}")
                finally:
                    processed += 1
                    progress["progress"] = int(processed * 100 / total_steps)
                    _save_progress(task_id, progress, task_type="bulk_completeness")

        progress["status"] = "completed"
        progress["results"] = {
            "action": action,
            "total_processed": processed,
            "successful": successful,
            "failed": failed,
        }
        progress["messages"].append(
            f"Completed bulk {action}. Success: {len(successful)}, Failed: {len(failed)}"
        )
        _save_progress(task_id, progress, task_type="bulk_completeness")
    except Exception as e:
        p = completeness_progress.get(task_id, {})
        p["status"] = "error"
        p.setdefault("messages", []).append(f"Error: {str(e)}")
        completeness_progress[task_id] = p
        _save_progress(task_id, p, task_type="bulk_completeness")