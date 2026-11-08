-- Property management database (PostgreSQL port of the 2008 Oracle schema)
-- Owner: property-ops. Last migration: 2021-04-12.

CREATE TABLE properties (
  property_id   TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,             -- office | retail | data_center
  total_sf      INTEGER NOT NULL
);

CREATE TABLE tenants (
  tenant_id     TEXT PRIMARY KEY,          -- matches LEASE-REC LR-TENANT-ID
  name          TEXT NOT NULL,
  property_id   TEXT REFERENCES properties,
  contact_email TEXT
);

CREATE TABLE units (
  unit_id       TEXT PRIMARY KEY,
  property_id   TEXT REFERENCES properties,
  tenant_id     TEXT REFERENCES tenants,
  sf            INTEGER NOT NULL
);

CREATE TABLE leases (
  lease_id      TEXT PRIMARY KEY,
  tenant_id     TEXT REFERENCES tenants,
  start_date    DATE NOT NULL,
  base_year     INTEGER,                   -- informational only; billing uses LEASEBIL
  cap_pct       NUMERIC(6,4),
  sla_target    NUMERIC(6,3)
);

CREATE TABLE invoices (
  invoice_id    BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT REFERENCES tenants,
  period        DATE NOT NULL,
  base_rent     NUMERIC(11,2),
  cam           NUMERIC(11,2),
  opex_pass     NUMERIC(11,2),
  sla_credit    NUMERIC(11,2),
  total         NUMERIC(11,2),
  loaded_from   TEXT DEFAULT 'PROP.INVOICE.DAILY'
);

CREATE TABLE vendors (
  vendor_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  badge_group   TEXT                       -- access_export.csv group name
);

CREATE TABLE work_orders (
  wo_id         BIGSERIAL PRIMARY KEY,
  property_id   TEXT REFERENCES properties,
  asset_id      TEXT,                      -- bms_config.json device id
  vendor_id     TEXT REFERENCES vendors,
  priority      TEXT,
  status        TEXT DEFAULT 'open',
  opened_at     TIMESTAMP DEFAULT now()
);

CREATE TABLE badge_grants (
  grant_id      BIGSERIAL PRIMARY KEY,
  badge_group   TEXT NOT NULL,
  door_id       TEXT NOT NULL,
  valid_until   TIMESTAMP NOT NULL,
  reason        TEXT
);

-- Added 2017 so vendors can get in for emergency work without calling security.
CREATE OR REPLACE FUNCTION grant_vendor_access() RETURNS trigger AS $$
BEGIN
  INSERT INTO badge_grants (badge_group, door_id, valid_until, reason)
  SELECT v.badge_group, 'DC-HALL-A', now() + interval '72 hours', 'WO ' || NEW.wo_id
  FROM vendors v WHERE v.vendor_id = NEW.vendor_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wo_vendor_access
AFTER INSERT ON work_orders
FOR EACH ROW EXECUTE FUNCTION grant_vendor_access();

-- Reporting view, unused since 2019.
CREATE VIEW v_coolflag_history AS SELECT period, sla_credit FROM invoices WHERE sla_credit > 0;
