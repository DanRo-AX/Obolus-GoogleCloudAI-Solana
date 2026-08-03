use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    ops::Deref,
    path::Path,
    time::Duration,
};

use postgres::{Client, NoTls, Row as PostgresRow, types::Type};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("postgres error: {0}")]
    Postgres(#[from] postgres::Error),
    #[error("query returned no rows")]
    QueryReturnedNoRows,
    #[error("database value conversion failed: {0}")]
    Conversion(String),
    #[error("unsupported PostgreSQL column type {0}")]
    UnsupportedPostgresType(String),
}

pub type Result<T> = std::result::Result<T, Error>;

pub trait OptionalExtension<T> {
    fn optional(self) -> Result<Option<T>>;
}

impl<T> OptionalExtension<T> for Result<T> {
    fn optional(self) -> Result<Option<T>> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

pub enum Connection {
    Sqlite(rusqlite::Connection),
    Postgres(Box<RefCell<BlockingClient>>),
}

pub struct BlockingClient {
    client: Option<Client>,
}

impl BlockingClient {
    fn new(client: Client) -> Self {
        Self {
            client: Some(client),
        }
    }

    fn get(&mut self) -> &mut Client {
        self.client
            .as_mut()
            .expect("PostgreSQL client is available")
    }
}

impl Drop for BlockingClient {
    fn drop(&mut self) {
        if let Some(client) = self.client.take() {
            blocking_postgres(|| drop(client));
        }
    }
}

impl Connection {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Ok(Self::Sqlite(rusqlite::Connection::open(path)?))
    }

    pub fn open_in_memory() -> Result<Self> {
        Ok(Self::Sqlite(rusqlite::Connection::open_in_memory()?))
    }

    pub fn connect_postgres(connection_string: &str) -> Result<Self> {
        let client = blocking_postgres(|| Client::connect(connection_string, NoTls))?;
        Ok(Self::Postgres(Box::new(RefCell::new(BlockingClient::new(
            client,
        )))))
    }

    pub fn is_sqlite(&self) -> bool {
        matches!(self, Self::Sqlite(_))
    }

    pub fn busy_timeout(&self, duration: Duration) -> Result<()> {
        if let Self::Sqlite(connection) = self {
            connection.busy_timeout(duration)?;
        }
        Ok(())
    }

    pub fn pragma_update(
        &self,
        database_name: Option<&str>,
        pragma_name: &str,
        pragma_value: &str,
    ) -> Result<()> {
        if let Self::Sqlite(connection) = self {
            connection.pragma_update(database_name, pragma_name, pragma_value)?;
        }
        Ok(())
    }

    pub fn transaction(&mut self) -> Result<Transaction<'_>> {
        match self {
            Self::Sqlite(connection) => connection.execute_batch("BEGIN IMMEDIATE")?,
            Self::Postgres(client) => {
                blocking_postgres(|| client.borrow_mut().get().batch_execute("BEGIN"))?
            }
        }
        Ok(Transaction {
            connection: self,
            active: true,
        })
    }

    pub fn execute<P>(&self, sql: &str, params: P) -> Result<usize>
    where
        P: IntoParams,
    {
        let params = params.into_params();
        match self {
            Self::Sqlite(connection) => {
                let refs = params.sqlite_refs();
                Ok(connection.execute(sql, refs.as_slice())?)
            }
            Self::Postgres(client) => {
                let sql = postgres_sql(sql);
                let refs = params.postgres_refs();
                let changed =
                    blocking_postgres(|| client.borrow_mut().get().execute(&sql, refs.as_slice()))?;
                usize::try_from(changed)
                    .map_err(|error| Error::Conversion(format!("affected row count: {error}")))
            }
        }
    }

    pub fn execute_batch(&self, sql: &str) -> Result<()> {
        match self {
            Self::Sqlite(connection) => connection.execute_batch(sql)?,
            Self::Postgres(client) => {
                if sql.to_ascii_uppercase().contains("CREATE TABLE") {
                    blocking_postgres(|| {
                        client
                            .borrow_mut()
                            .get()
                            .batch_execute("CREATE EXTENSION IF NOT EXISTS citext")
                    })?;
                }
                for statement in ordered_postgres_statements(sql) {
                    blocking_postgres(|| {
                        client
                            .borrow_mut()
                            .get()
                            .batch_execute(&format!("{statement};"))
                    })?;
                }
            }
        }
        Ok(())
    }

    pub fn query_row<P, F, T>(&self, sql: &str, params: P, mapper: F) -> Result<T>
    where
        P: IntoParams,
        F: FnOnce(&Row) -> Result<T>,
    {
        let mut rows = self.materialize(sql, params)?;
        let row = rows.drain(..).next().ok_or(Error::QueryReturnedNoRows)?;
        mapper(&row)
    }

    pub fn prepare(&self, sql: &str) -> Result<Statement<'_>> {
        Ok(Statement {
            connection: self,
            sql: sql.to_owned(),
        })
    }

    pub fn column_exists(&self, table: &str, column: &str) -> Result<bool> {
        match self {
            Self::Sqlite(connection) => {
                let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
                let names = statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                Ok(names.iter().any(|name| name == column))
            }
            Self::Postgres(client) => {
                let row = blocking_postgres(|| {
                    client.borrow_mut().get().query_one(
                        "SELECT EXISTS(
                            SELECT 1 FROM information_schema.columns
                            WHERE table_schema = current_schema()
                              AND table_name = $1 AND column_name = $2
                         )",
                        &[&table, &column],
                    )
                })?;
                Ok(row.get(0))
            }
        }
    }

    fn materialize<P>(&self, sql: &str, params: P) -> Result<Vec<Row>>
    where
        P: IntoParams,
    {
        let params = params.into_params();
        match self {
            Self::Sqlite(connection) => {
                let mut statement = connection.prepare(sql)?;
                let column_count = statement.column_count();
                let refs = params.sqlite_refs();
                let mut rows = statement.query(refs.as_slice())?;
                let mut materialized = Vec::new();
                while let Some(row) = rows.next()? {
                    let mut cells = Vec::with_capacity(column_count);
                    for index in 0..column_count {
                        use rusqlite::types::ValueRef;
                        let cell = match row.get_ref(index)? {
                            ValueRef::Null => Cell::Null,
                            ValueRef::Integer(value) => Cell::Integer(value),
                            ValueRef::Real(value) => Cell::Real(value),
                            ValueRef::Text(value) => Cell::Text(
                                std::str::from_utf8(value)
                                    .map_err(|error| Error::Conversion(error.to_string()))?
                                    .to_owned(),
                            ),
                            ValueRef::Blob(value) => Cell::Bytes(value.to_vec()),
                        };
                        cells.push(cell);
                    }
                    materialized.push(Row { cells });
                }
                Ok(materialized)
            }
            Self::Postgres(client) => {
                let sql = postgres_sql(sql);
                let refs = params.postgres_refs();
                blocking_postgres(|| client.borrow_mut().get().query(&sql, refs.as_slice()))?
                    .iter()
                    .map(materialize_postgres_row)
                    .collect()
            }
        }
    }
}

fn blocking_postgres<T>(operation: impl FnOnce() -> T) -> T {
    if tokio::runtime::Handle::try_current().is_ok() {
        tokio::task::block_in_place(operation)
    } else {
        operation()
    }
}

pub struct Transaction<'a> {
    connection: &'a Connection,
    active: bool,
}

impl Transaction<'_> {
    pub fn execute<P>(&self, sql: &str, params: P) -> Result<usize>
    where
        P: IntoParams,
    {
        self.connection.execute(sql, params)
    }

    pub fn query_row<P, F, T>(&self, sql: &str, params: P, mapper: F) -> Result<T>
    where
        P: IntoParams,
        F: FnOnce(&Row) -> Result<T>,
    {
        self.connection.query_row(sql, params, mapper)
    }

    pub fn prepare(&self, sql: &str) -> Result<Statement<'_>> {
        self.connection.prepare(sql)
    }

    pub fn commit(mut self) -> Result<()> {
        self.connection.execute_batch("COMMIT")?;
        self.active = false;
        Ok(())
    }
}

impl Deref for Transaction<'_> {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        self.connection
    }
}

impl Drop for Transaction<'_> {
    fn drop(&mut self) {
        if self.active {
            let _ = self.connection.execute_batch("ROLLBACK");
        }
    }
}

pub struct Statement<'a> {
    connection: &'a Connection,
    sql: String,
}

impl Statement<'_> {
    pub fn query_map<P, F, T>(&mut self, params: P, mut mapper: F) -> Result<MappedRows<T>>
    where
        P: IntoParams,
        F: FnMut(&Row) -> Result<T>,
    {
        let mapped = self
            .connection
            .materialize(&self.sql, params)?
            .iter()
            .map(&mut mapper)
            .collect::<Vec<_>>()
            .into_iter();
        Ok(MappedRows { inner: mapped })
    }
}

pub struct MappedRows<T> {
    inner: std::vec::IntoIter<Result<T>>,
}

impl<T> Iterator for MappedRows<T> {
    type Item = Result<T>;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner.next()
    }
}

#[derive(Debug, Clone)]
pub enum Cell {
    Null,
    Integer(i64),
    Real(f64),
    Bool(bool),
    Text(String),
    Bytes(Vec<u8>),
}

pub struct Row {
    cells: Vec<Cell>,
}

pub trait RowIndex {
    fn index(self) -> usize;
}

impl RowIndex for usize {
    fn index(self) -> usize {
        self
    }
}

impl Row {
    pub fn get<I, T>(&self, index: I) -> Result<T>
    where
        I: RowIndex,
        T: FromCell,
    {
        let index = index.index();
        let cell = self
            .cells
            .get(index)
            .ok_or_else(|| Error::Conversion(format!("column index {index} is out of range")))?;
        T::from_cell(cell)
    }
}

pub trait FromCell: Sized {
    fn from_cell(cell: &Cell) -> Result<Self>;
}

impl FromCell for String {
    fn from_cell(cell: &Cell) -> Result<Self> {
        match cell {
            Cell::Text(value) => Ok(value.clone()),
            other => Err(Error::Conversion(format!("expected text, got {other:?}"))),
        }
    }
}

impl FromCell for i64 {
    fn from_cell(cell: &Cell) -> Result<Self> {
        match cell {
            Cell::Integer(value) => Ok(*value),
            Cell::Bool(value) => Ok(i64::from(*value)),
            other => Err(Error::Conversion(format!(
                "expected integer, got {other:?}"
            ))),
        }
    }
}

impl FromCell for u8 {
    fn from_cell(cell: &Cell) -> Result<Self> {
        let value = i64::from_cell(cell)?;
        u8::try_from(value).map_err(|error| Error::Conversion(error.to_string()))
    }
}

impl FromCell for f32 {
    fn from_cell(cell: &Cell) -> Result<Self> {
        match cell {
            Cell::Real(value) => Ok(*value as f32),
            Cell::Integer(value) => Ok(*value as f32),
            other => Err(Error::Conversion(format!("expected real, got {other:?}"))),
        }
    }
}

impl FromCell for f64 {
    fn from_cell(cell: &Cell) -> Result<Self> {
        match cell {
            Cell::Real(value) => Ok(*value),
            Cell::Integer(value) => Ok(*value as f64),
            other => Err(Error::Conversion(format!("expected real, got {other:?}"))),
        }
    }
}

impl FromCell for bool {
    fn from_cell(cell: &Cell) -> Result<Self> {
        match cell {
            Cell::Bool(value) => Ok(*value),
            Cell::Integer(value) => Ok(*value != 0),
            other => Err(Error::Conversion(format!(
                "expected boolean, got {other:?}"
            ))),
        }
    }
}

impl FromCell for Vec<u8> {
    fn from_cell(cell: &Cell) -> Result<Self> {
        match cell {
            Cell::Bytes(value) => Ok(value.clone()),
            other => Err(Error::Conversion(format!("expected bytes, got {other:?}"))),
        }
    }
}

impl<T> FromCell for Option<T>
where
    T: FromCell,
{
    fn from_cell(cell: &Cell) -> Result<Self> {
        if matches!(cell, Cell::Null) {
            Ok(None)
        } else {
            T::from_cell(cell).map(Some)
        }
    }
}

fn materialize_postgres_row(row: &PostgresRow) -> Result<Row> {
    let mut cells = Vec::with_capacity(row.len());
    for (index, column) in row.columns().iter().enumerate() {
        let cell = match *column.type_() {
            Type::BOOL => row
                .try_get::<_, Option<bool>>(index)?
                .map(Cell::Bool)
                .unwrap_or(Cell::Null),
            Type::INT2 => row
                .try_get::<_, Option<i16>>(index)?
                .map(|value| Cell::Integer(i64::from(value)))
                .unwrap_or(Cell::Null),
            Type::INT4 | Type::OID => row
                .try_get::<_, Option<i32>>(index)?
                .map(|value| Cell::Integer(i64::from(value)))
                .unwrap_or(Cell::Null),
            Type::INT8 => row
                .try_get::<_, Option<i64>>(index)?
                .map(Cell::Integer)
                .unwrap_or(Cell::Null),
            Type::FLOAT4 => row
                .try_get::<_, Option<f32>>(index)?
                .map(|value| Cell::Real(f64::from(value)))
                .unwrap_or(Cell::Null),
            Type::FLOAT8 => row
                .try_get::<_, Option<f64>>(index)?
                .map(Cell::Real)
                .unwrap_or(Cell::Null),
            Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::UNKNOWN => row
                .try_get::<_, Option<String>>(index)?
                .map(Cell::Text)
                .unwrap_or(Cell::Null),
            Type::BYTEA => row
                .try_get::<_, Option<Vec<u8>>>(index)?
                .map(Cell::Bytes)
                .unwrap_or(Cell::Null),
            ref unsupported => {
                return Err(Error::UnsupportedPostgresType(
                    unsupported.name().to_owned(),
                ));
            }
        };
        cells.push(cell);
    }
    Ok(Row { cells })
}

#[derive(Debug, Clone)]
pub enum DbParam {
    Text(String),
    Integer(i64),
    Real32(f32),
    Real64(f64),
    Bool(bool),
    Bytes(Vec<u8>),
    OptionalText(Option<String>),
    OptionalInteger(Option<i64>),
    OptionalReal32(Option<f32>),
    OptionalReal64(Option<f64>),
    OptionalBool(Option<bool>),
    OptionalBytes(Option<Vec<u8>>),
}

pub struct DbParams(Vec<DbParam>);

impl DbParams {
    pub fn new(values: Vec<DbParam>) -> Self {
        Self(values)
    }

    fn sqlite_refs(&self) -> Vec<&dyn rusqlite::ToSql> {
        self.0
            .iter()
            .map(|value| match value {
                DbParam::Text(value) => value as &dyn rusqlite::ToSql,
                DbParam::Integer(value) => value as &dyn rusqlite::ToSql,
                DbParam::Real32(value) => value as &dyn rusqlite::ToSql,
                DbParam::Real64(value) => value as &dyn rusqlite::ToSql,
                DbParam::Bool(value) => value as &dyn rusqlite::ToSql,
                DbParam::Bytes(value) => value as &dyn rusqlite::ToSql,
                DbParam::OptionalText(value) => value as &dyn rusqlite::ToSql,
                DbParam::OptionalInteger(value) => value as &dyn rusqlite::ToSql,
                DbParam::OptionalReal32(value) => value as &dyn rusqlite::ToSql,
                DbParam::OptionalReal64(value) => value as &dyn rusqlite::ToSql,
                DbParam::OptionalBool(value) => value as &dyn rusqlite::ToSql,
                DbParam::OptionalBytes(value) => value as &dyn rusqlite::ToSql,
            })
            .collect()
    }

    fn postgres_refs(&self) -> Vec<&(dyn postgres::types::ToSql + Sync)> {
        self.0
            .iter()
            .map(|value| match value {
                DbParam::Text(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::Integer(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::Real32(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::Real64(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::Bool(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::Bytes(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::OptionalText(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::OptionalInteger(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::OptionalReal32(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::OptionalReal64(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::OptionalBool(value) => value as &(dyn postgres::types::ToSql + Sync),
                DbParam::OptionalBytes(value) => value as &(dyn postgres::types::ToSql + Sync),
            })
            .collect()
    }
}

pub trait ToDbParam {
    fn to_db_param(&self) -> DbParam;
}

pub fn to_db_param<T>(value: &T) -> DbParam
where
    T: ToDbParam + ?Sized,
{
    value.to_db_param()
}

impl<T> ToDbParam for &T
where
    T: ToDbParam + ?Sized,
{
    fn to_db_param(&self) -> DbParam {
        (*self).to_db_param()
    }
}

impl ToDbParam for str {
    fn to_db_param(&self) -> DbParam {
        DbParam::Text(self.to_owned())
    }
}

impl ToDbParam for String {
    fn to_db_param(&self) -> DbParam {
        DbParam::Text(self.clone())
    }
}

macro_rules! integer_param {
    ($type:ty) => {
        impl ToDbParam for $type {
            fn to_db_param(&self) -> DbParam {
                DbParam::Integer(*self as i64)
            }
        }
    };
}

integer_param!(i64);
integer_param!(i32);
integer_param!(usize);
integer_param!(u64);
integer_param!(u32);

impl ToDbParam for f32 {
    fn to_db_param(&self) -> DbParam {
        DbParam::Real32(*self)
    }
}

impl ToDbParam for f64 {
    fn to_db_param(&self) -> DbParam {
        DbParam::Real64(*self)
    }
}

impl ToDbParam for bool {
    fn to_db_param(&self) -> DbParam {
        DbParam::Bool(*self)
    }
}

impl ToDbParam for Vec<u8> {
    fn to_db_param(&self) -> DbParam {
        DbParam::Bytes(self.clone())
    }
}

impl ToDbParam for Option<String> {
    fn to_db_param(&self) -> DbParam {
        DbParam::OptionalText(self.clone())
    }
}

impl ToDbParam for Option<&str> {
    fn to_db_param(&self) -> DbParam {
        DbParam::OptionalText(self.map(ToOwned::to_owned))
    }
}

impl ToDbParam for Option<i64> {
    fn to_db_param(&self) -> DbParam {
        DbParam::OptionalInteger(*self)
    }
}

impl ToDbParam for Option<u64> {
    fn to_db_param(&self) -> DbParam {
        DbParam::OptionalInteger(self.map(|value| value as i64))
    }
}

impl ToDbParam for Option<f32> {
    fn to_db_param(&self) -> DbParam {
        DbParam::OptionalReal32(*self)
    }
}

impl ToDbParam for Option<f64> {
    fn to_db_param(&self) -> DbParam {
        DbParam::OptionalReal64(*self)
    }
}

impl ToDbParam for Option<bool> {
    fn to_db_param(&self) -> DbParam {
        DbParam::OptionalBool(*self)
    }
}

impl ToDbParam for Option<Vec<u8>> {
    fn to_db_param(&self) -> DbParam {
        DbParam::OptionalBytes(self.clone())
    }
}

pub trait IntoParams {
    fn into_params(self) -> DbParams;
}

impl IntoParams for DbParams {
    fn into_params(self) -> DbParams {
        self
    }
}

impl<T, const N: usize> IntoParams for [T; N]
where
    T: ToDbParam,
{
    fn into_params(self) -> DbParams {
        DbParams::new(self.iter().map(ToDbParam::to_db_param).collect())
    }
}

impl<T> IntoParams for &[T]
where
    T: ToDbParam,
{
    fn into_params(self) -> DbParams {
        DbParams::new(self.iter().map(ToDbParam::to_db_param).collect())
    }
}

#[macro_export]
macro_rules! params {
    () => {
        $crate::db::DbParams::new(Vec::new())
    };
    ($($value:expr),+ $(,)?) => {
        $crate::db::DbParams::new(vec![$($crate::db::to_db_param(&$value)),+])
    };
}

fn postgres_sql(sql: &str) -> String {
    let mut output = String::with_capacity(sql.len() + 16);
    let bytes = sql.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'?' && index + 1 < bytes.len() && bytes[index + 1].is_ascii_digit() {
            output.push('$');
            index += 1;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                output.push(bytes[index] as char);
                index += 1;
            }
        } else {
            output.push(bytes[index] as char);
            index += 1;
        }
    }
    output = output.replace(" COLLATE NOCASE", "");
    let trimmed = output.trim();
    if trimmed
        .to_ascii_uppercase()
        .starts_with("INSERT OR IGNORE INTO")
    {
        let replaced = trimmed.replacen("INSERT OR IGNORE INTO", "INSERT INTO", 1);
        return format!("{} ON CONFLICT DO NOTHING", replaced.trim_end_matches(';'));
    }
    output
}

fn ordered_postgres_statements(sql: &str) -> Vec<String> {
    let statements = sql
        .split(';')
        .map(str::trim)
        .filter(|statement| !statement.is_empty())
        .map(postgres_schema_sql)
        .collect::<Vec<_>>();

    let mut tables = HashMap::new();
    let mut rest = Vec::new();
    for statement in statements {
        if let Some(table) = created_table(&statement) {
            tables.insert(table, statement);
        } else {
            rest.push(statement);
        }
    }
    if tables.is_empty() {
        return rest;
    }

    let known = tables.keys().cloned().collect::<HashSet<_>>();
    let mut emitted = HashSet::new();
    let mut ordered = Vec::new();
    while !tables.is_empty() {
        let ready = tables
            .iter()
            .find(|(_, statement)| {
                referenced_tables(statement)
                    .into_iter()
                    .all(|dependency| !known.contains(&dependency) || emitted.contains(&dependency))
            })
            .map(|(table, _)| table.clone());
        let Some(table) = ready else {
            // The current schema has no cycles. Surface a deterministic database
            // error rather than silently dropping a foreign-key constraint.
            ordered.extend(tables.into_values());
            break;
        };
        if let Some(statement) = tables.remove(&table) {
            emitted.insert(table);
            ordered.push(statement);
        }
    }
    ordered.extend(rest);
    ordered
}

fn postgres_schema_sql(sql: &str) -> String {
    let sql = sql.replace("TEXT COLLATE NOCASE", "CITEXT");
    replace_sql_word(&postgres_sql(&sql), "INTEGER", "BIGINT")
        .replace(" COLLATE NOCASE", "")
        .replace(" BLOB", " BYTEA")
}

fn replace_sql_word(sql: &str, word: &str, replacement: &str) -> String {
    sql.split_inclusive(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .map(|part| {
            let token_length = part
                .chars()
                .take_while(|character| character.is_ascii_alphanumeric() || *character == '_')
                .map(char::len_utf8)
                .sum::<usize>();
            let (token, suffix) = part.split_at(token_length);
            if token.eq_ignore_ascii_case(word) {
                format!("{replacement}{suffix}")
            } else {
                part.to_owned()
            }
        })
        .collect()
}

fn created_table(statement: &str) -> Option<String> {
    let upper = statement.to_ascii_uppercase();
    let prefix = "CREATE TABLE IF NOT EXISTS ";
    let start = upper.find(prefix)? + prefix.len();
    statement[start..]
        .split_whitespace()
        .next()
        .map(|table| table.trim_matches('"').to_owned())
}

fn referenced_tables(statement: &str) -> Vec<String> {
    let upper = statement.to_ascii_uppercase();
    let bytes = upper.as_bytes();
    let marker = b"REFERENCES ";
    let mut references = Vec::new();
    let mut index = 0;
    while index + marker.len() <= bytes.len() {
        if &bytes[index..index + marker.len()] == marker {
            let start = index + marker.len();
            let end = statement[start..]
                .find(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
                .map(|offset| start + offset)
                .unwrap_or(statement.len());
            references.push(statement[start..end].to_owned());
            index = end;
        } else {
            index += 1;
        }
    }
    references
}

#[cfg(test)]
mod tests {
    use super::{postgres_schema_sql, postgres_sql};

    #[test]
    fn translates_sqlite_placeholders_and_ignore() {
        assert_eq!(
            postgres_sql("INSERT OR IGNORE INTO users (id) VALUES (?1)"),
            "INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING"
        );
    }

    #[test]
    fn translates_schema_integer_width_and_collation() {
        assert_eq!(
            postgres_schema_sql("email TEXT COLLATE NOCASE, created_at INTEGER"),
            "email CITEXT, created_at BIGINT"
        );
    }

    #[test]
    fn translates_blob_columns() {
        assert_eq!(
            postgres_schema_sql("payload BLOB NOT NULL"),
            "payload BYTEA NOT NULL"
        );
    }
}
