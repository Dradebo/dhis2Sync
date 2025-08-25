from fastapi import APIRouter, Request, BackgroundTasks, HTTPException
from fastapi.templating import Jinja2Templates
from typing import Dict, Any, List, Set
import difflib
import time

from ..dhis2_api import Api

router = APIRouter(prefix="/metadata", tags=["metadata"])
templates = Jinja2Templates(directory="app/templates")

# Local progress store to avoid coupling with main
metadata_progress: Dict[str, Dict[str, Any]] = {}


def _fetch_type(api: Api, obj_type: str):
    # Minimal fields per type for comparison
    if obj_type == "organisationUnits":
        endpoint = "api/organisationUnits.json"
        params = {"fields": "id,code,displayName,level,parent[id]", "paging": "false"}
    elif obj_type == "categoryOptions":
        endpoint = "api/categoryOptions.json"
        params = {"fields": "id,code,displayName", "paging": "false"}
    elif obj_type == "categories":
        endpoint = "api/categories.json"
        params = {"fields": "id,code,displayName,categoryOptions[id]", "paging": "false"}
    elif obj_type == "categoryCombos":
        endpoint = "api/categoryCombos.json"
        params = {"fields": "id,code,displayName,categories[id]", "paging": "false"}
    elif obj_type == "categoryOptionCombos":
        endpoint = "api/categoryOptionCombos.json"
        params = {"fields": "id,code,displayName,categoryCombo[id]", "paging": "false"}
    elif obj_type == "optionSets":
        endpoint = "api/optionSets.json"
        params = {"fields": "id,code,displayName,options[id,code,displayName]", "paging": "false"}
    elif obj_type == "dataElements":
        endpoint = "api/dataElements.json"
        params = {"fields": "id,code,displayName,valueType,categoryCombo[id],optionSet[id]", "paging": "false"}
    elif obj_type == "dataSets":
        endpoint = "api/dataSets.json"
        params = {"fields": "id,code,displayName,periodType,categoryCombo[id],dataSetElements[dataElement[id,code]]", "paging": "false"}
    else:
        return []

    resp = api.get(endpoint, params=params)
    if resp.status_code != 200:
        return []
    data = resp.json()
    return data.get(obj_type, [])


# Minimal full fetch per item for payload building
def _fetch_full_item(api: Api, obj_type: str, uid: str) -> Dict[str, Any]:
    if obj_type == "categoryOptions":
        ep = f"api/categoryOptions/{uid}.json"
        params = {"fields": "id,code,displayName,name,shortName"}
    elif obj_type == "categories":
        ep = f"api/categories/{uid}.json"
        params = {"fields": "id,code,displayName,name,shortName,dataDimensionType,categoryOptions[id]"}
    elif obj_type == "categoryCombos":
        ep = f"api/categoryCombos/{uid}.json"
        params = {"fields": "id,code,displayName,name,categories[id]"}
    elif obj_type == "categoryOptionCombos":
        ep = f"api/categoryOptionCombos/{uid}.json"
        params = {"fields": "id,code,displayName,name,categoryCombo[id]"}
    elif obj_type == "optionSets":
        ep = f"api/optionSets/{uid}.json"
        params = {"fields": "id,code,displayName,name,valueType,options[id,code,displayName,name]"}
    elif obj_type == "options":
        ep = f"api/options/{uid}.json"
        params = {"fields": "id,code,displayName,name"}
    elif obj_type == "dataElements":
        ep = f"api/dataElements/{uid}.json"
        params = {"fields": "id,code,displayName,name,shortName,valueType,aggregationType,domainType,categoryCombo[id],optionSet[id]"}
    elif obj_type == "dataSets":
        ep = f"api/dataSets/{uid}.json"
        params = {"fields": "id,code,displayName,name,shortName,periodType,categoryCombo[id],dataSetElements[dataElement[id]]"}
    elif obj_type == "organisationUnits":
        ep = f"api/organisationUnits/{uid}.json"
        params = {"fields": "id,code,displayName,name,parent[id]"}
    else:
        return {}
    r = api.get(ep, params=params)
    return r.json() if r.status_code == 200 else {}


def _remap_uid(t: str, uid: str, mappings: Dict[str, Dict[str, str]]) -> str:
    if not uid:
        return uid
    m = mappings.get(t, {}) if mappings else {}
    return m.get(uid, uid)


def _build_payload_for_types(types: List[str], source_api: Api, dest_api: Api, mappings: Dict[str, Dict[str, str]]) -> Dict[str, Any]:
    # Determine missing by type using summaries
    payload: Dict[str, List[Dict[str, Any]]] = {}
    summaries = {}
    for t in types:
        src = _fetch_type(source_api, t)
        dst = _fetch_type(dest_api, t)
        summaries[t] = {"src": src, "dst": dst}

    def add(t: str, obj: Dict[str, Any]):
        if not obj:
            return
        if t not in payload:
            payload[t] = []
        # Avoid duplicates by id
        existing = {o.get("id") for o in payload[t]}
        if obj.get("id") not in existing:
            payload[t].append(obj)

    # Helper: is missing in dest by id
    def is_missing(t: str, uid: str) -> bool:
        dst_by_id = _index_by(summaries[t]["dst"], "id")
        if uid in dst_by_id:
            return False
        # If mapped to an existing destination UID, treat as not missing
        mapped = _remap_uid(t, uid, mappings)
        if mapped in dst_by_id:
            return False
        return True

    # Helpers for defaults
    def _short(name: str) -> str:
        return (name or "")[:50]

    def _ensure_required(t: str, minimal: Dict[str, Any], full: Dict[str, Any]):
        # Common name/shortName
        if "shortName" not in minimal and (full.get("shortName") or full.get("name") or full.get("displayName")):
            minimal["shortName"] = _short(full.get("shortName") or full.get("name") or full.get("displayName") or "")

        if t == "categories":
            if "dataDimensionType" not in minimal:
                minimal["dataDimensionType"] = full.get("dataDimensionType") or "DISAGGREGATION"
        elif t == "dataElements":
            if "aggregationType" not in minimal:
                minimal["aggregationType"] = full.get("aggregationType") or "SUM"
            if "domainType" not in minimal:
                minimal["domainType"] = full.get("domainType") or "AGGREGATE"
        elif t == "dataSets":
            # shortName handled above
            pass
        elif t == "organisationUnits":
            if "openingDate" not in minimal:
                # Opening date required for OU creation in many versions
                minimal["openingDate"] = full.get("openingDate") or "1970-01-01"
        elif t == "categoryOptions":
            # shortName handled above
            pass
        elif t == "optionSets":
            if "valueType" not in minimal and full.get("valueType"):
                minimal["valueType"] = full.get("valueType")

    # OptionSets require options
    if "optionSets" in types:
        src_list = summaries["optionSets"]["src"]
        for s in src_list:
            uid = s.get("id")
            if not uid or not is_missing("optionSets", uid):
                continue
            full = _fetch_full_item(source_api, "optionSets", uid)
            # Remap self ID if mapping exists (skip creating mapped destination item)
            if not is_missing("optionSets", uid):
                pass
            minimal = {k: v for k, v in full.items() if k in ("id","code","name","displayName","options","valueType")}
            _ensure_required("optionSets", minimal, full)
            add("optionSets", minimal)
            # Ensure options are included
            for opt in (full.get("options") or []):
                opt_uid = opt.get("id")
                if not opt_uid:
                    continue
                # Check if option exists by id on dest via options endpoint lightweight check is expensive; include if referenced
                add("options", {k: opt.get(k) for k in ("id","code","name","displayName")})

    # Category hierarchy
    for t in ["categoryOptions", "categories", "categoryCombos", "categoryOptionCombos"]:
        if t not in types:
            continue
        for s in summaries[t]["src"]:
            uid = s.get("id")
            if not uid or not is_missing(t, uid):
                continue
            full = _fetch_full_item(source_api, t, uid)
            # Keep minimal fields
            minimal = {k: full.get(k) for k in ("id","code","name","displayName","shortName") if full.get(k)}
            # Keep relationships and ensure required
            if t == "categories":
                minimal["categoryOptions"] = [{"id": _remap_uid("categoryOptions", co.get("id"), mappings)} for co in (full.get("categoryOptions") or []) if co.get("id")]
                _ensure_required("categories", minimal, full)
            if t == "categoryCombos":
                minimal["categories"] = [{"id": _remap_uid("categories", c.get("id"), mappings)} for c in (full.get("categories") or []) if c.get("id")]
            if t == "categoryOptionCombos":
                ccid = (full.get("categoryCombo") or {}).get("id")
                minimal["categoryCombo"] = {"id": _remap_uid("categoryCombos", ccid, mappings)}
            _ensure_required(t, minimal, full)
            add(t, minimal)

    # Data elements
    if "dataElements" in types:
        for s in summaries["dataElements"]["src"]:
            uid = s.get("id")
            if not uid or not is_missing("dataElements", uid):
                continue
            full = _fetch_full_item(source_api, "dataElements", uid)
            minimal = {k: full.get(k) for k in ("id","code","name","displayName","shortName","valueType","aggregationType","domainType") if full.get(k)}
            if full.get("categoryCombo"):
                minimal["categoryCombo"] = {"id": _remap_uid("categoryCombos", full["categoryCombo"].get("id"), mappings)}
            if full.get("optionSet"):
                minimal["optionSet"] = {"id": _remap_uid("optionSets", full["optionSet"].get("id"), mappings)}
            _ensure_required("dataElements", minimal, full)
            add("dataElements", minimal)

    # Data sets (reference DEs must exist; here we include dataset only)
    if "dataSets" in types:
        for s in summaries["dataSets"]["src"]:
            uid = s.get("id")
            if not uid or not is_missing("dataSets", uid):
                continue
            full = _fetch_full_item(source_api, "dataSets", uid)
            minimal = {k: full.get(k) for k in ("id","code","name","displayName","shortName","periodType") if full.get(k)}
            if full.get("categoryCombo"):
                minimal["categoryCombo"] = {"id": _remap_uid("categoryCombos", full["categoryCombo"].get("id"), mappings)}
            # include dataSetElements ids only
            dse = full.get("dataSetElements") or []
            minimal["dataSetElements"] = [{"dataElement": {"id": _remap_uid("dataElements", e.get("dataElement", {}).get("id"), mappings)}} for e in dse if e.get("dataElement", {}).get("id")]
            _ensure_required("dataSets", minimal, full)
            add("dataSets", minimal)

    # Organisation units (include minimal)
    if "organisationUnits" in types:
        for s in summaries["organisationUnits"]["src"]:
            uid = s.get("id")
            if not uid or not is_missing("organisationUnits", uid):
                continue
            full = _fetch_full_item(source_api, "organisationUnits", uid)
            minimal = {k: full.get(k) for k in ("id","code","name","displayName") if full.get(k)}
            if full.get("parent"):
                minimal["parent"] = {"id": _remap_uid("organisationUnits", full["parent"].get("id"), mappings)}
            _ensure_required("organisationUnits", minimal, full)
            add("organisationUnits", minimal)

    return payload


def _fetch_required_fields_map(dest_api: Api, type_map: Dict[str, str]) -> Dict[str, Set[str]]:
    """Fetch required field names per type from destination /api/schemas.
    type_map maps our type keys (e.g., 'dataElements') to DHIS2 klass names (e.g., 'DataElement').
    """
    resp = dest_api.get("api/schemas", params={"paging": "false"})
    if resp.status_code != 200:
        return {}
    data = resp.json()
    all_schemas = data.get("schemas", [])
    # Build lookup by klass base name
    by_klass = {}
    for s in all_schemas:
        klass = s.get("klass") or ""
        base = klass.split(".")[-1]
        by_klass[base] = s
    out: Dict[str, Set[str]] = {}
    for our_type, klass in type_map.items():
        schema = by_klass.get(klass)
        if not schema:
            continue
        req = set(schema.get("requiredProperties") or schema.get("required") or [])
        out[our_type] = req
    return out


@router.post("/payload/preview")
async def build_metadata_payload_preview(request: Request):
    """Build a minimal metadata payload for missing items for the selected types.
    This does not apply changes; it returns a payload preview to use with dry-run/apply.
    """
    try:
        data = await request.json()
        types = data.get("types") or [
            "organisationUnits", "categories", "categoryCombos", "categoryOptions", "categoryOptionCombos",
            "optionSets", "dataElements", "dataSets"
        ]

        connections = request.session.get("connections")
        if not connections or not ("source" in connections and "dest" in connections):
            raise HTTPException(400, "No DHIS2 connections configured in session")

        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])

        # Optional: include destination schema requirements for visibility
        type_map = {
            "organisationUnits": "OrganisationUnit",
            "categoryOptions": "CategoryOption",
            "categories": "Category",
            "categoryCombos": "CategoryCombo",
            "categoryOptionCombos": "CategoryOptionCombo",
            "optionSets": "OptionSet",
            "dataElements": "DataElement",
            "dataSets": "DataSet",
        }
        required_map = _fetch_required_fields_map(dest_api, type_map)

        mappings = request.session.get("metadata_mappings", {})
        payload = _build_payload_for_types(types, source_api, dest_api, mappings)
        counts = {k: len(v) for k, v in payload.items()}
        return {"payload": payload, "counts": counts, "required": {k: sorted(list(v)) for k, v in required_map.items()} }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Payload build failed: {str(e)}")


def _name_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, (a or "").lower(), (b or "").lower()).ratio()


def _index_by(items: List[Dict[str, Any]], key: str) -> Dict[str, Dict[str, Any]]:
    return {i.get(key): i for i in items if i.get(key)}


def _compare_lists(src: List[Dict[str, Any]], dst: List[Dict[str, Any]], obj_type: str) -> Dict[str, Any]:
    """Return missing/conflicts/suggestions per type.
    Matching order: id -> code; suggestions by name similarity.
    """
    src_by_id = _index_by(src, "id")
    dst_by_id = _index_by(dst, "id")
    src_by_code = _index_by(src, "code")
    dst_by_code = _index_by(dst, "code")

    missing = []
    conflicts = []
    suggestions = []

    # Critical fields per type for conflicts
    critical_fields = {
        "organisationUnits": ["displayName", "level", "parent"],
        "categoryOptions": ["displayName"],
        "categories": ["displayName", "categoryOptions"],
        "categoryCombos": ["displayName", "categories"],
        "categoryOptionCombos": ["displayName", "categoryCombo"],
        "optionSets": ["displayName", "options"],
        "dataElements": ["displayName", "valueType", "categoryCombo", "optionSet"],
        "dataSets": ["displayName", "periodType", "categoryCombo", "dataSetElements"],
    }.get(obj_type, ["displayName"]) 

    # Helper to extract comparable shape
    def compact(item):
        out = {
            "id": item.get("id"),
            "code": item.get("code"),
            "name": item.get("displayName") or item.get("name"),
        }
        for f in critical_fields:
            out[f] = item.get(f)
        return out

    # Detect missing and conflicts by id/code
    for sid, sitem in src_by_id.items():
        ditem = dst_by_id.get(sid)
        if not ditem:
            # Try match by code
            scode = sitem.get("code")
            if scode and scode in dst_by_code:
                ditem = dst_by_code.get(scode)
        if not ditem:
            missing.append({"id": sitem.get("id"), "code": sitem.get("code"), "name": sitem.get("displayName") or sitem.get("name")})
            continue
        # Compare critical fields for conflict
        scomp = compact(sitem)
        dcomp = compact(ditem)
        diffs = {}
        for f in critical_fields:
            if scomp.get(f) != dcomp.get(f):
                diffs[f] = {"source": scomp.get(f), "dest": dcomp.get(f)}
        if diffs:
            conflicts.append({"id": scomp.get("id"), "code": scomp.get("code"), "name": scomp.get("name"), "diffs": diffs})

    # Suggestions by code or name
    # Build quick lookups for codes and names
    dst_names = [(d.get("id"), d.get("code"), d.get("displayName") or d.get("name") or "") for d in dst]
    for s in src:
        sid = s.get("id")
        if sid in dst_by_id:
            continue
        scode = s.get("code")
        sname = s.get("displayName") or s.get("name") or ""
        if scode and scode in dst_by_code:
            suggestions.append({
                "source": {"id": sid, "code": scode, "name": sname},
                "dest": {"id": dst_by_code[scode]["id"], "code": scode, "name": dst_by_code[scode].get("displayName") or dst_by_code[scode].get("name")},
                "confidence": 1.0,
                "by": "code"
            })
            continue
        # name similarity
        best = (None, 0.0)
        for did, dcode, dname in dst_names:
            score = _name_similarity(sname, dname)
            if score > best[1]:
                best = ((did, dcode, dname), score)
        if best[1] >= 0.7:
            did, dcode, dname = best[0]
            suggestions.append({
                "source": {"id": sid, "code": scode, "name": sname},
                "dest": {"id": did, "code": dcode, "name": dname},
                "confidence": round(best[1], 3),
                "by": "name"
            })

    return {"missing": missing, "conflicts": conflicts, "suggestions": suggestions}


@router.post("/summary")
async def metadata_summary(request: Request):
    """Fetch minimal metadata for selected types from both instances using session connections."""
    try:
        data = await request.json()
        types = data.get("types") or [
            "organisationUnits", "categoryOptions", "categories", "categoryCombos", "categoryOptionCombos",
            "optionSets", "dataElements", "dataSets"
        ]

        connections = request.session.get("connections")
        if not connections or not ("source" in connections and "dest" in connections):
            raise HTTPException(400, "No DHIS2 connections configured in session")

        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])

        out = {}
        for t in types:
            out[t] = {
                "source": _fetch_type(source_api, t),
                "dest": _fetch_type(dest_api, t)
            }
        return out
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Metadata summary failed: {str(e)}")


def _perform_diff(task_id: str, session_data: Dict[str, Any], types: List[str]):
    progress = metadata_progress[task_id]
    try:
        progress["messages"].append("Starting metadata assessment...")
        progress["status"] = "running"
        progress["progress"] = 5

        connections = session_data.get("connections")
        source_api = Api(**connections["source"])
        dest_api = Api(**connections["dest"])

        results = {}
        step = 0
        total = max(1, len(types))

        for t in types:
            step += 1
            progress["messages"].append(f"Fetching {t} from source and destination...")
            src = _fetch_type(source_api, t)
            dst = _fetch_type(dest_api, t)
            progress["messages"].append(f"Comparing {t} ({len(src)} vs {len(dst)})...")
            results[t] = _compare_lists(src, dst, t)
            progress["progress"] = 5 + int(90 * step / total)

        progress["messages"].append("Assessment complete.")
        progress["status"] = "completed"
        progress["progress"] = 100
        progress["results"] = results
        progress["completed_at"] = time.time()
    except Exception as e:
        progress["status"] = "error"
        progress["messages"].append(f"Error: {str(e)}")


@router.post("/diff")
async def metadata_diff(request: Request, background_tasks: BackgroundTasks):
    """Start a background diff/assessment for selected metadata types."""
    try:
        data = await request.json()
        types = data.get("types") or [
            "organisationUnits", "categories", "categoryCombos", "categoryOptions", "categoryOptionCombos",
            "optionSets", "dataElements", "dataSets"
        ]

        connections = request.session.get("connections")
        if not connections or not ("source" in connections and "dest" in connections):
            raise HTTPException(400, "No DHIS2 connections configured in session")

        task_id = f"metadata_{len(metadata_progress)}"
        metadata_progress[task_id] = {"status": "starting", "progress": 0, "messages": []}

        background_tasks.add_task(_perform_diff, task_id, {"connections": connections}, types)

        return {"task_id": task_id, "status": "started"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Metadata diff start failed: {str(e)}")


@router.get("/progress/{task_id}")
async def metadata_progress_status(task_id: str):
    if task_id not in metadata_progress:
        raise HTTPException(404, "Task not found")
    return metadata_progress[task_id]


@router.post("/mappings/save")
async def save_mappings(request: Request):
    """Persist accepted mapping pairs into session, organized by type."""
    try:
        data = await request.json()
        pairs = data.get("pairs", [])
        if not isinstance(pairs, list):
            raise HTTPException(400, "pairs must be a list")

        mappings = request.session.get("metadata_mappings", {})
        updated = 0
        for pair in pairs:
            t = pair.get("type")
            src = pair.get("sourceId")
            dst = pair.get("destId")
            if not t or not src or not dst:
                continue
            if t not in mappings:
                mappings[t] = {}
            # store mapping src -> dst
            if mappings[t].get(src) != dst:
                mappings[t][src] = dst
                updated += 1

        request.session["metadata_mappings"] = mappings
        return {"saved": updated, "types": list(mappings.keys())}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to save mappings: {str(e)}")


@router.get("/mappings")
async def get_mappings(request: Request):
    """Return saved mappings from session."""
    return request.session.get("metadata_mappings", {})


@router.post("/dry-run")
async def dry_run_metadata(request: Request):
    """Perform a metadata import dry-run against the destination instance using session connection.
    Body: { payload: {..}, importStrategy?: str, atomicMode?: str }
    """
    try:
        data = await request.json()
        payload = data.get("payload") or {}
        if not isinstance(payload, dict):
            raise HTTPException(400, "payload must be a JSON object")

        import_strategy = data.get("importStrategy", "CREATE_AND_UPDATE")
        atomic_mode = data.get("atomicMode", "ALL")

        connections = request.session.get("connections")
        if not connections or "dest" not in connections:
            raise HTTPException(400, "No destination connection configured in session")

        dest_api = Api(**connections["dest"])
        endpoint = f"api/metadata?importStrategy={import_strategy}&atomicMode={atomic_mode}&dryRun=true"
        resp = dest_api.post(endpoint, payload)
        try:
            body = resp.json()
        except Exception:
            body = {"text": resp.text[:1000]}
        if resp.status_code not in (200, 201):
            return {"error": f"HTTP {resp.status_code}", "body": body}
        return body
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Dry-run failed: {str(e)}")


@router.post("/apply")
async def apply_metadata(request: Request):
    """Apply a metadata import to the destination instance (no dryRun). Use cautiously."""
    try:
        data = await request.json()
        payload = data.get("payload") or {}
        if not isinstance(payload, dict):
            raise HTTPException(400, "payload must be a JSON object")

        import_strategy = data.get("importStrategy", "CREATE_AND_UPDATE")
        atomic_mode = data.get("atomicMode", "ALL")

        connections = request.session.get("connections")
        if not connections or "dest" not in connections:
            raise HTTPException(400, "No destination connection configured in session")

        dest_api = Api(**connections["dest"])
        endpoint = f"api/metadata?importStrategy={import_strategy}&atomicMode={atomic_mode}"
        resp = dest_api.post(endpoint, payload)
        try:
            body = resp.json()
        except Exception:
            body = {"text": resp.text[:1000]}
        if resp.status_code not in (200, 201):
            return {"error": f"HTTP {resp.status_code}", "body": body}
        return body
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Apply failed: {str(e)}")


