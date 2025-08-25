from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class ConnectionForm(BaseModel):
    """Form data for DHIS2 connections"""
    source_url: str
    source_username: str
    source_password: str
    dest_url: str
    dest_username: str
    dest_password: str

class DatasetSelection(BaseModel):
    """Form data for dataset selection"""
    source_dataset: str
    dest_dataset: str
    period: str

class ElementMapping(BaseModel):
    """Data element mapping configuration"""
    source_element_id: str
    dest_element_id: str

class TransferProgress(BaseModel):
    """Progress tracking for data transfer"""
    task_id: str
    status: str  # starting, running, completed, error
    progress: int  # 0-100
    messages: List[str]
    
class CompletenessConfig(BaseModel):
    """Configuration for completeness assessment"""
    dataset_id: str
    required_elements: List[str]
    threshold: int = 0
    include_parents: bool = False

class TransferResult(BaseModel):
    """Results from data transfer operation"""
    total_values: int
    mapped_values: int
    transfer_status: str
    import_summary: Dict[str, Any]
    
class CompletenessResult(BaseModel):
    """Results from completeness assessment"""
    total_completed: int
    total_unmarked: int
    total_errors: int
    hierarchy: Dict[str, Any]