export namespace audit {
	
	export class DataIssue {
	    data_element_id: string;
	    value: string;
	    issue_type: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new DataIssue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data_element_id = source["data_element_id"];
	        this.value = source["value"];
	        this.issue_type = source["issue_type"];
	        this.count = source["count"];
	    }
	}
	export class MatchSuggestion {
	    id: string;
	    name: string;
	    score: number;
	
	    static createFrom(source: any = {}) {
	        return new MatchSuggestion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.score = source["score"];
	    }
	}
	export class MissingItem {
	    id: string;
	    name: string;
	    type: string;
	    suggestion?: MatchSuggestion;
	
	    static createFrom(source: any = {}) {
	        return new MissingItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.suggestion = this.convertValues(source["suggestion"], MatchSuggestion);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AuditResult {
	    missing_org_units: MissingItem[];
	    missing_cocs: MissingItem[];
	    data_issues: DataIssue[];
	
	    static createFrom(source: any = {}) {
	        return new AuditResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.missing_org_units = this.convertValues(source["missing_org_units"], MissingItem);
	        this.missing_cocs = this.convertValues(source["missing_cocs"], MissingItem);
	        this.data_issues = this.convertValues(source["data_issues"], DataIssue);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AuditProgress {
	    task_id: string;
	    status: string;
	    progress: number;
	    messages: string[];
	    results?: AuditResult;
	
	    static createFrom(source: any = {}) {
	        return new AuditProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task_id = source["task_id"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.messages = source["messages"];
	        this.results = this.convertValues(source["results"], AuditResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	

}

export namespace completeness {
	
	export class OrgUnitComplianceInfo {
	    id: string;
	    name: string;
	    compliance_percentage: number;
	    elements_present: number;
	    elements_required: number;
	    missing_elements: string[];
	    has_data: boolean;
	    total_entries: number;
	
	    static createFrom(source: any = {}) {
	        return new OrgUnitComplianceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.compliance_percentage = source["compliance_percentage"];
	        this.elements_present = source["elements_present"];
	        this.elements_required = source["elements_required"];
	        this.missing_elements = source["missing_elements"];
	        this.has_data = source["has_data"];
	        this.total_entries = source["total_entries"];
	    }
	}
	export class HierarchyResult {
	    name: string;
	    compliant: OrgUnitComplianceInfo[];
	    non_compliant: OrgUnitComplianceInfo[];
	    children?: OrgUnitComplianceInfo[];
	    unmarked?: OrgUnitComplianceInfo[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new HierarchyResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.compliant = this.convertValues(source["compliant"], OrgUnitComplianceInfo);
	        this.non_compliant = this.convertValues(source["non_compliant"], OrgUnitComplianceInfo);
	        this.children = this.convertValues(source["children"], OrgUnitComplianceInfo);
	        this.unmarked = this.convertValues(source["unmarked"], OrgUnitComplianceInfo);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AssessmentResult {
	    total_compliant: number;
	    total_non_compliant: number;
	    total_errors: number;
	    hierarchy: Record<string, HierarchyResult>;
	    compliance_details: Record<string, OrgUnitComplianceInfo>;
	
	    static createFrom(source: any = {}) {
	        return new AssessmentResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total_compliant = source["total_compliant"];
	        this.total_non_compliant = source["total_non_compliant"];
	        this.total_errors = source["total_errors"];
	        this.hierarchy = this.convertValues(source["hierarchy"], HierarchyResult, true);
	        this.compliance_details = this.convertValues(source["compliance_details"], OrgUnitComplianceInfo, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AssessmentProgress {
	    task_id: string;
	    profile_id?: string;
	    status: string;
	    progress: number;
	    messages: string[];
	    results?: AssessmentResult;
	    completed_at?: number;
	
	    static createFrom(source: any = {}) {
	        return new AssessmentProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task_id = source["task_id"];
	        this.profile_id = source["profile_id"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.messages = source["messages"];
	        this.results = this.convertValues(source["results"], AssessmentResult);
	        this.completed_at = source["completed_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AssessmentRequest {
	    profile_id: string;
	    instance: string;
	    dataset_id: string;
	    periods: string[];
	    parent_org_units: string[];
	    required_elements: string[];
	    compliance_threshold: number;
	    include_parents: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AssessmentRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profile_id = source["profile_id"];
	        this.instance = source["instance"];
	        this.dataset_id = source["dataset_id"];
	        this.periods = source["periods"];
	        this.parent_org_units = source["parent_org_units"];
	        this.required_elements = source["required_elements"];
	        this.compliance_threshold = source["compliance_threshold"];
	        this.include_parents = source["include_parents"];
	    }
	}
	
	export class BulkActionResult {
	    action: string;
	    total_processed: number;
	    successful: string[];
	    failed: string[];
	
	    static createFrom(source: any = {}) {
	        return new BulkActionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.action = source["action"];
	        this.total_processed = source["total_processed"];
	        this.successful = source["successful"];
	        this.failed = source["failed"];
	    }
	}
	export class BulkActionProgress {
	    task_id: string;
	    status: string;
	    progress: number;
	    messages: string[];
	    results?: BulkActionResult;
	    completed_at?: number;
	
	    static createFrom(source: any = {}) {
	        return new BulkActionProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task_id = source["task_id"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.messages = source["messages"];
	        this.results = this.convertValues(source["results"], BulkActionResult);
	        this.completed_at = source["completed_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BulkActionRequest {
	    profile_id: string;
	    instance: string;
	    action: string;
	    org_units: string[];
	    dataset_id: string;
	    periods: string[];
	
	    static createFrom(source: any = {}) {
	        return new BulkActionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profile_id = source["profile_id"];
	        this.instance = source["instance"];
	        this.action = source["action"];
	        this.org_units = source["org_units"];
	        this.dataset_id = source["dataset_id"];
	        this.periods = source["periods"];
	    }
	}
	
	

}

export namespace main {
	
	export class CreateProfileRequest {
	    name: string;
	    owner: string;
	    source_url: string;
	    source_username: string;
	    source_password: string;
	    dest_url: string;
	    dest_username: string;
	    dest_password: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateProfileRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.owner = source["owner"];
	        this.source_url = source["source_url"];
	        this.source_username = source["source_username"];
	        this.source_password = source["source_password"];
	        this.dest_url = source["dest_url"];
	        this.dest_username = source["dest_username"];
	        this.dest_password = source["dest_password"];
	    }
	}
	export class JobHistoryResponse {
	    task_id: string;
	    job_type: string;
	    status: string;
	    started_at: string;
	    completed_at?: string;
	    summary: string;
	    progress: number;
	
	    static createFrom(source: any = {}) {
	        return new JobHistoryResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task_id = source["task_id"];
	        this.job_type = source["job_type"];
	        this.status = source["status"];
	        this.started_at = source["started_at"];
	        this.completed_at = source["completed_at"];
	        this.summary = source["summary"];
	        this.progress = source["progress"];
	    }
	}
	export class TestConnectionRequest {
	    url: string;
	    username: string;
	    password: string;
	
	    static createFrom(source: any = {}) {
	        return new TestConnectionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.username = source["username"];
	        this.password = source["password"];
	    }
	}
	export class TestConnectionResponse {
	    success: boolean;
	    error?: string;
	    user_name?: string;
	    server_info?: string;
	
	    static createFrom(source: any = {}) {
	        return new TestConnectionResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.error = source["error"];
	        this.user_name = source["user_name"];
	        this.server_info = source["server_info"];
	    }
	}

}

export namespace metadata {
	
	export class SuggestionDetail {
	    id: string;
	    code: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new SuggestionDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.code = source["code"];
	        this.name = source["name"];
	    }
	}
	export class SuggestionItem {
	    source: SuggestionDetail;
	    dest: SuggestionDetail;
	    confidence: number;
	    by: string;
	
	    static createFrom(source: any = {}) {
	        return new SuggestionItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.source = this.convertValues(source["source"], SuggestionDetail);
	        this.dest = this.convertValues(source["dest"], SuggestionDetail);
	        this.confidence = source["confidence"];
	        this.by = source["by"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ConflictItem {
	    id: string;
	    code: string;
	    name: string;
	    diffs: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new ConflictItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.code = source["code"];
	        this.name = source["name"];
	        this.diffs = source["diffs"];
	    }
	}
	export class MissingItem {
	    id: string;
	    code: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new MissingItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.code = source["code"];
	        this.name = source["name"];
	    }
	}
	export class ComparisonResult {
	    missing: MissingItem[];
	    conflicts: ConflictItem[];
	    suggestions: SuggestionItem[];
	
	    static createFrom(source: any = {}) {
	        return new ComparisonResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.missing = this.convertValues(source["missing"], MissingItem);
	        this.conflicts = this.convertValues(source["conflicts"], ConflictItem);
	        this.suggestions = this.convertValues(source["suggestions"], SuggestionItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class DiffProgress {
	    task_id: string;
	    status: string;
	    progress: number;
	    messages: string[];
	    results?: Record<string, ComparisonResult>;
	    completed_at?: number;
	
	    static createFrom(source: any = {}) {
	        return new DiffProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task_id = source["task_id"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.messages = source["messages"];
	        this.results = this.convertValues(source["results"], ComparisonResult, true);
	        this.completed_at = source["completed_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ObjectReport {
	    uid: string;
	    errorReports?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ObjectReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.uid = source["uid"];
	        this.errorReports = source["errorReports"];
	    }
	}
	export class TypeReport {
	    klass: string;
	    stats: Record<string, any>;
	    objectReports?: ObjectReport[];
	
	    static createFrom(source: any = {}) {
	        return new TypeReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.klass = source["klass"];
	        this.stats = source["stats"];
	        this.objectReports = this.convertValues(source["objectReports"], ObjectReport);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ImportReport {
	    status: string;
	    typeReports?: TypeReport[];
	    stats?: Record<string, any>;
	    message?: string;
	    error?: string;
	    body?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new ImportReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.typeReports = this.convertValues(source["typeReports"], TypeReport);
	        this.stats = source["stats"];
	        this.message = source["message"];
	        this.error = source["error"];
	        this.body = source["body"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MappingPair {
	    type: string;
	    sourceId: string;
	    destId: string;
	
	    static createFrom(source: any = {}) {
	        return new MappingPair(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.sourceId = source["sourceId"];
	        this.destId = source["destId"];
	    }
	}
	
	
	export class PayloadPreviewResponse {
	    payload: Record<string, Array<any>>;
	    counts: Record<string, number>;
	    required: Record<string, Array<string>>;
	
	    static createFrom(source: any = {}) {
	        return new PayloadPreviewResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.payload = source["payload"];
	        this.counts = source["counts"];
	        this.required = source["required"];
	    }
	}
	export class SaveMappingsResponse {
	    saved: number;
	    types: string[];
	
	    static createFrom(source: any = {}) {
	        return new SaveMappingsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.saved = source["saved"];
	        this.types = source["types"];
	    }
	}
	
	

}

export namespace models {
	
	export class ConnectionProfile {
	    id: string;
	    name: string;
	    owner: string;
	    source_url: string;
	    source_username: string;
	    dest_url: string;
	    dest_username: string;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    updated_at: any;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.owner = source["owner"];
	        this.source_url = source["source_url"];
	        this.source_username = source["source_username"];
	        this.dest_url = source["dest_url"];
	        this.dest_username = source["dest_username"];
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.updated_at = this.convertValues(source["updated_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace scheduler {
	
	export class JobListResponse {
	    id: string;
	    name: string;
	    job_type: string;
	    cron: string;
	    timezone: string;
	    enabled: boolean;
	    last_run_at?: string;
	    next_run?: string;
	    created_at: string;
	    updated_at: string;
	
	    static createFrom(source: any = {}) {
	        return new JobListResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.job_type = source["job_type"];
	        this.cron = source["cron"];
	        this.timezone = source["timezone"];
	        this.enabled = source["enabled"];
	        this.last_run_at = source["last_run_at"];
	        this.next_run = source["next_run"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	    }
	}
	export class UpsertJobRequest {
	    name: string;
	    job_type: string;
	    cron: string;
	    timezone: string;
	    enabled: boolean;
	    payload: any;
	
	    static createFrom(source: any = {}) {
	        return new UpsertJobRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.job_type = source["job_type"];
	        this.cron = source["cron"];
	        this.timezone = source["timezone"];
	        this.enabled = source["enabled"];
	        this.payload = source["payload"];
	    }
	}

}

export namespace tracker {
	
	export class PreviewRequest {
	    profile_id: string;
	    instance: string;
	    program_id: string;
	    org_units: string[];
	    start_date: string;
	    end_date: string;
	    program_stage?: string;
	    status?: string;
	    preview_cap: number;
	    page_size: number;
	
	    static createFrom(source: any = {}) {
	        return new PreviewRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profile_id = source["profile_id"];
	        this.instance = source["instance"];
	        this.program_id = source["program_id"];
	        this.org_units = source["org_units"];
	        this.start_date = source["start_date"];
	        this.end_date = source["end_date"];
	        this.program_stage = source["program_stage"];
	        this.status = source["status"];
	        this.preview_cap = source["preview_cap"];
	        this.page_size = source["page_size"];
	    }
	}
	export class PreviewResponse {
	    program_id: string;
	    org_units: string[];
	    start_date: string;
	    end_date: string;
	    estimate_total: number;
	    sample: any[];
	
	    static createFrom(source: any = {}) {
	        return new PreviewResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.program_id = source["program_id"];
	        this.org_units = source["org_units"];
	        this.start_date = source["start_date"];
	        this.end_date = source["end_date"];
	        this.estimate_total = source["estimate_total"];
	        this.sample = source["sample"];
	    }
	}
	export class ProgramStage {
	    id: string;
	    displayName: string;
	
	    static createFrom(source: any = {}) {
	        return new ProgramStage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.displayName = source["displayName"];
	    }
	}
	export class Program {
	    id: string;
	    displayName: string;
	    programType: string;
	    version: number;
	    programStages?: ProgramStage[];
	
	    static createFrom(source: any = {}) {
	        return new Program(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.displayName = source["displayName"];
	        this.programType = source["programType"];
	        this.version = source["version"];
	        this.programStages = this.convertValues(source["programStages"], ProgramStage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class TransferResult {
	    total_fetched: number;
	    total_sent: number;
	    batches_sent: number;
	    dry_run: boolean;
	    partial?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TransferResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total_fetched = source["total_fetched"];
	        this.total_sent = source["total_sent"];
	        this.batches_sent = source["batches_sent"];
	        this.dry_run = source["dry_run"];
	        this.partial = source["partial"];
	    }
	}
	export class TransferProgress {
	    task_id: string;
	    status: string;
	    progress: number;
	    messages: string[];
	    results?: TransferResult;
	    completed_at?: number;
	
	    static createFrom(source: any = {}) {
	        return new TransferProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task_id = source["task_id"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.messages = source["messages"];
	        this.results = this.convertValues(source["results"], TransferResult);
	        this.completed_at = source["completed_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TransferRequest {
	    profile_id: string;
	    program_id: string;
	    org_units: string[];
	    start_date: string;
	    end_date: string;
	    program_stage?: string;
	    status?: string;
	    dry_run: boolean;
	    batch_size: number;
	    max_pages: number;
	    max_runtime_seconds: number;
	
	    static createFrom(source: any = {}) {
	        return new TransferRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profile_id = source["profile_id"];
	        this.program_id = source["program_id"];
	        this.org_units = source["org_units"];
	        this.start_date = source["start_date"];
	        this.end_date = source["end_date"];
	        this.program_stage = source["program_stage"];
	        this.status = source["status"];
	        this.dry_run = source["dry_run"];
	        this.batch_size = source["batch_size"];
	        this.max_pages = source["max_pages"];
	        this.max_runtime_seconds = source["max_runtime_seconds"];
	    }
	}

}

export namespace transfer {
	
	export class CategoryOptionCombo {
	    id: string;
	    name: string;
	    code: string;
	
	    static createFrom(source: any = {}) {
	        return new CategoryOptionCombo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.code = source["code"];
	    }
	}
	export class CategoryCombo {
	    id: string;
	    name: string;
	    code: string;
	    categoryOptionCombos: CategoryOptionCombo[];
	
	    static createFrom(source: any = {}) {
	        return new CategoryCombo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.code = source["code"];
	        this.categoryOptionCombos = this.convertValues(source["categoryOptionCombos"], CategoryOptionCombo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class DataElement {
	    id: string;
	    name: string;
	    displayName: string;
	    code: string;
	    valueType: string;
	
	    static createFrom(source: any = {}) {
	        return new DataElement(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.code = source["code"];
	        this.valueType = source["valueType"];
	    }
	}
	export class DataValue {
	    dataElement: string;
	    period: string;
	    orgUnit: string;
	    categoryOptionCombo: string;
	    attributeOptionCombo: string;
	    value: string;
	    storedBy?: string;
	    created?: string;
	    lastUpdated?: string;
	    comment?: string;
	    followUp?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DataValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dataElement = source["dataElement"];
	        this.period = source["period"];
	        this.orgUnit = source["orgUnit"];
	        this.categoryOptionCombo = source["categoryOptionCombo"];
	        this.attributeOptionCombo = source["attributeOptionCombo"];
	        this.value = source["value"];
	        this.storedBy = source["storedBy"];
	        this.created = source["created"];
	        this.lastUpdated = source["lastUpdated"];
	        this.comment = source["comment"];
	        this.followUp = source["followUp"];
	    }
	}
	export class Dataset {
	    id: string;
	    name: string;
	    displayName: string;
	    code: string;
	    periodType: string;
	
	    static createFrom(source: any = {}) {
	        return new Dataset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.code = source["code"];
	        this.periodType = source["periodType"];
	    }
	}
	export class OrgUnitParentRef {
	    id: string;
	
	    static createFrom(source: any = {}) {
	        return new OrgUnitParentRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	    }
	}
	export class OrganisationUnit {
	    id: string;
	    name: string;
	    displayName: string;
	    code: string;
	    level: number;
	    path: string;
	    parent?: OrgUnitParentRef;
	
	    static createFrom(source: any = {}) {
	        return new OrganisationUnit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.code = source["code"];
	        this.level = source["level"];
	        this.path = source["path"];
	        this.parent = this.convertValues(source["parent"], OrgUnitParentRef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DatasetInfo {
	    id: string;
	    name: string;
	    displayName: string;
	    code: string;
	    periodType: string;
	    dataElements: DataElement[];
	    categoryCombo?: CategoryCombo;
	    organisationUnits: OrganisationUnit[];
	
	    static createFrom(source: any = {}) {
	        return new DatasetInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.code = source["code"];
	        this.periodType = source["periodType"];
	        this.dataElements = this.convertValues(source["dataElements"], DataElement);
	        this.categoryCombo = this.convertValues(source["categoryCombo"], CategoryCombo);
	        this.organisationUnits = this.convertValues(source["organisationUnits"], OrganisationUnit);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ImportConflict {
	    object: string;
	    value: string;
	    errorCode: string;
	
	    static createFrom(source: any = {}) {
	        return new ImportConflict(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.object = source["object"];
	        this.value = source["value"];
	        this.errorCode = source["errorCode"];
	    }
	}
	export class ImportCount {
	    imported: number;
	    updated: number;
	    ignored: number;
	    deleted: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportCount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.imported = source["imported"];
	        this.updated = source["updated"];
	        this.ignored = source["ignored"];
	        this.deleted = source["deleted"];
	    }
	}
	export class ImportSummary {
	    status: string;
	    description: string;
	    importCount: ImportCount;
	    conflicts?: ImportConflict[];
	    dataSetComplete?: string;
	
	    static createFrom(source: any = {}) {
	        return new ImportSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.description = source["description"];
	        this.importCount = this.convertValues(source["importCount"], ImportCount);
	        this.conflicts = this.convertValues(source["conflicts"], ImportConflict);
	        this.dataSetComplete = source["dataSetComplete"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class OrgUnitTreeNode {
	    id: string;
	    name: string;
	    displayName: string;
	    code: string;
	    level: number;
	    path: string;
	    has_children: boolean;
	    children?: OrgUnitTreeNode[];
	
	    static createFrom(source: any = {}) {
	        return new OrgUnitTreeNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.code = source["code"];
	        this.level = source["level"];
	        this.path = source["path"];
	        this.has_children = source["has_children"];
	        this.children = this.convertValues(source["children"], OrgUnitTreeNode);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class OrgUnitTreeResponse {
	    root_nodes: OrgUnitTreeNode[];
	    total_count: number;
	
	    static createFrom(source: any = {}) {
	        return new OrgUnitTreeResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.root_nodes = this.convertValues(source["root_nodes"], OrgUnitTreeNode);
	        this.total_count = source["total_count"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Resolution {
	    id: string;
	    type: string;
	    action: string;
	
	    static createFrom(source: any = {}) {
	        return new Resolution(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.action = source["action"];
	    }
	}
	export class TransferProgress {
	    task_id: string;
	    status: string;
	    progress: number;
	    messages: string[];
	    total_fetched: number;
	    total_mapped: number;
	    total_imported: number;
	    result?: ImportSummary;
	    error?: string;
	    unmapped_values?: Record<string, Array<DataValue>>;
	    started_at: string;
	    completed_at?: string;
	
	    static createFrom(source: any = {}) {
	        return new TransferProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task_id = source["task_id"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.messages = source["messages"];
	        this.total_fetched = source["total_fetched"];
	        this.total_mapped = source["total_mapped"];
	        this.total_imported = source["total_imported"];
	        this.result = this.convertValues(source["result"], ImportSummary);
	        this.error = source["error"];
	        this.unmapped_values = this.convertValues(source["unmapped_values"], Array<DataValue>, true);
	        this.started_at = source["started_at"];
	        this.completed_at = source["completed_at"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TransferRequest {
	    profile_id: string;
	    source_dataset: string;
	    dest_dataset: string;
	    periods: string[];
	    org_unit_selection_mode: string;
	    org_unit_ids: string[];
	    element_mapping: Record<string, string>;
	    resolutions: Resolution[];
	    mark_complete: boolean;
	    attribute_option_combo_id: string;
	
	    static createFrom(source: any = {}) {
	        return new TransferRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profile_id = source["profile_id"];
	        this.source_dataset = source["source_dataset"];
	        this.dest_dataset = source["dest_dataset"];
	        this.periods = source["periods"];
	        this.org_unit_selection_mode = source["org_unit_selection_mode"];
	        this.org_unit_ids = source["org_unit_ids"];
	        this.element_mapping = source["element_mapping"];
	        this.resolutions = this.convertValues(source["resolutions"], Resolution);
	        this.mark_complete = source["mark_complete"];
	        this.attribute_option_combo_id = source["attribute_option_combo_id"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

