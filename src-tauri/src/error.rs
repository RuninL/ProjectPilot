use serde::Serialize;

/// Error type returned to the frontend from custom commands.
/// Serializes to a stable `{ code, message }` shape so the TS layer can map it to `AppError`.
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("path resolution error: {0}")]
    Path(String),
    #[error("{0}")]
    Invalid(String),
}

impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let code = match self {
            CommandError::Sqlite(_) => "DB_ERROR",
            CommandError::Io(_) => "IO_ERROR",
            CommandError::Path(_) => "PATH_ERROR",
            CommandError::Invalid(_) => "INVALID",
        };
        let mut state = serializer.serialize_struct("CommandError", 2)?;
        state.serialize_field("code", code)?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
