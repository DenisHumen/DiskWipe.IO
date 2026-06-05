//! Data types shared across the backend and serialized to the frontend.
//! Field names are camelCased to match the TypeScript model in `src/types.ts`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    /// Stable identifier handed back to the backend — equals `path`.
    pub id: String,
    /// OS device path, e.g. `/dev/sda` or `\\.\PhysicalDrive0`.
    pub path: String,
    pub model: String,
    pub serial: String,
    pub size_bytes: u64,
    /// True when the disk hosts the running OS — protected from formatting.
    pub is_system: bool,
    pub is_removable: bool,
    pub bus: String,
    /// True for spinning HDDs, false for SSD/flash.
    pub rotational: bool,
    pub mountpoints: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAttribute {
    pub id: u64,
    pub name: String,
    pub value: i64,
    pub worst: i64,
    pub threshold: i64,
    pub raw: String,
    /// "ok" | "warn" | "bad"
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartReport {
    pub device: String,
    pub model: String,
    pub serial: String,
    pub firmware: String,
    pub capacity_bytes: u64,
    pub temperature_c: Option<i64>,
    pub power_on_hours: Option<i64>,
    pub power_cycles: Option<i64>,
    pub health_passed: bool,
    /// "good" | "caution" | "bad" | "unknown"
    pub overall: String,
    pub protocol: String,
    pub rotation_rate: Option<i64>,
    pub attributes: Vec<SmartAttribute>,
    pub nvme: Option<BTreeMap<String, i64>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // some fields are only consumed on Linux/Windows format paths
pub struct FormatRequest {
    pub disk_id: String,
    /// "quick" | "full"
    pub mode: String,
    pub filesystem: String,
    pub label: String,
    /// Must equal the real device serial — explicit safety confirmation.
    pub confirm_serial: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatProgress {
    pub disk_id: String,
    pub phase: String,
    pub percent: f64,
    pub message: String,
}
