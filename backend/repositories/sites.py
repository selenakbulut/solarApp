from ..database import transaction
from ..errors import ConflictError, NotFoundError

LOSS_COLUMNS = (
    "soiling_loss", "reflection_loss", "mismatch_loss", "dc_cable_loss",
    "ac_cable_loss", "transformer_loss", "shading_loss", "availability_loss", "snow_loss",
)


class SiteRepository:
    def __init__(self, db_path):
        self.db_path = db_path

    def list(self):
        with transaction(self.db_path) as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM sites ORDER BY name")]

    def get(self, site_id):
        with transaction(self.db_path) as connection:
            row = connection.execute("SELECT * FROM sites WHERE id = ?", (site_id,)).fetchone()
        if row is None:
            raise NotFoundError("Santral bulunamadı.")
        return dict(row)

    def create(self, values):
        columns = tuple(values)
        with transaction(self.db_path) as connection:
            connection.execute('BEGIN IMMEDIATE')
            duplicate = connection.execute("""
                SELECT id FROM sites WHERE name = ? AND latitude = ? AND longitude = ?
            """, (values["name"], values["latitude"], values["longitude"])).fetchone()
            if duplicate:
                raise ConflictError("Bu isim ve koordinatlarla kayıtlı santral zaten var.")
            cursor = connection.execute(
                f"INSERT INTO sites ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                tuple(values[column] for column in columns),
            )
            site_id = cursor.lastrowid
        return self.get(site_id)

    def losses(self, site_id):
        self.get(site_id)
        with transaction(self.db_path) as connection:
            row = connection.execute("SELECT * FROM site_losses WHERE site_id = ?", (site_id,)).fetchone()
        return {column: row[column] for column in LOSS_COLUMNS} if row else None

    def save_losses(self, site_id, values):
        self.get(site_id)
        with transaction(self.db_path) as connection:
            connection.execute(
                f"INSERT INTO site_losses (site_id, {', '.join(LOSS_COLUMNS)}) "
                f"VALUES ({', '.join('?' for _ in range(10))}) "
                "ON CONFLICT(site_id) DO UPDATE SET "
                + ', '.join(f"{name}=excluded.{name}" for name in LOSS_COLUMNS),
                (site_id, *(values[name] for name in LOSS_COLUMNS)),
            )
        return self.losses(site_id)
