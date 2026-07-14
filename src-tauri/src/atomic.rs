use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use tauri::{AppHandle, Manager};

use crate::error::{CommandError, CommandResult};

/// A single parameterized statement in an atomic batch.
/// `params` use positional `?1..?n` binding (rusqlite style).
#[derive(Debug, Deserialize)]
pub struct BatchStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<JsonValue>,
}

/// Resolve the SQLite file path. Must match the path tauri-plugin-sql loads
/// (`sqlite:projectpilot.db` resolves against the app config dir).
pub fn db_path(app: &AppHandle) -> CommandResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| CommandError::Path(e.to_string()))?;
    Ok(dir.join("projectpilot.db"))
}

/// Convert a JSON parameter into a value rusqlite can bind.
/// Objects/arrays are serialized to JSON text (mirrors how the frontend stores JSON columns).
fn json_to_sql(value: &JsonValue) -> CommandResult<SqlValue> {
    Ok(match value {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(i64::from(*b)),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                return Err(CommandError::Invalid(format!("unsupported number: {n}")));
            }
        }
        JsonValue::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    })
}

fn open_connection(path: &std::path::Path) -> CommandResult<Connection> {
    let conn = Connection::open(path)?;
    // Foreign keys are OFF by default in SQLite; enforce per connection.
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

/// Execute several statements inside a single connection and transaction.
/// Any failure rolls the whole batch back (drop of an uncommitted transaction rolls back).
/// Returns the total number of affected rows.
#[tauri::command]
pub fn execute_batch(app: AppHandle, statements: Vec<BatchStatement>) -> CommandResult<usize> {
    if statements.is_empty() {
        return Ok(0);
    }
    let path = db_path(&app)?;
    let mut conn = open_connection(&path)?;

    let tx = conn.transaction()?;
    let mut affected: usize = 0;
    for stmt in &statements {
        let bound: Vec<SqlValue> = stmt
            .params
            .iter()
            .map(json_to_sql)
            .collect::<CommandResult<_>>()?;
        let param_refs: Vec<&dyn rusqlite::ToSql> =
            bound.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        affected += tx.execute(&stmt.sql, param_refs.as_slice())?;
    }
    tx.commit()?;
    Ok(affected)
}
